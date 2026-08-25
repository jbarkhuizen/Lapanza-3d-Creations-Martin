import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';

let activeRunId = null;

function recoverInterruptedRuns() {
  if (activeRunId) return;
  getDb().prepare(`
    UPDATE test_runs
    SET status = 'failed', completed_at = ?, output = CASE
      WHEN output = '' THEN 'Test run was interrupted by an application restart.'
      ELSE output || '\n\nTest run was interrupted by an application restart.'
    END
    WHERE status = 'running'
  `).run(new Date().toISOString());
}

function testFiles(root) {
  return fs.readdirSync(path.join(root, 'server'))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => `server/${name}`);
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTestCases(file, root) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const matches = [...source.matchAll(/\btest\(\s*'([^']+)'/g)];
  return matches.map((match, index) => ({
    id: Buffer.from(`${file}:${index}`).toString('base64url'),
    file,
    name: match[1],
  }));
}

export function listTestCases(root = process.cwd()) {
  recoverInterruptedRuns();
  const db = getDb();
  const latestStatuses = db.prepare(`
    SELECT c.test_case_id, c.status, c.completed_at
    FROM test_run_cases c
    WHERE c.completed_at = (
      SELECT MAX(c2.completed_at) FROM test_run_cases c2 WHERE c2.test_case_id = c.test_case_id
    )
  `).all();
  const byId = new Map(latestStatuses.map((item) => [item.test_case_id, item]));
  return testFiles(root).flatMap((file) => parseTestCases(file, root).map((item) => ({
    ...item,
    lastStatus: byId.get(item.id)?.status || null,
    lastRunAt: byId.get(item.id)?.completed_at || null,
  })));
}

export function listTestRuns(limit = 20) {
  recoverInterruptedRuns();
  return getDb().prepare(`
    SELECT id, scope, status, requested_by, started_at, completed_at, duration_ms, passed_count, failed_count, skipped_count
    FROM test_runs ORDER BY started_at DESC LIMIT ?
  `).all(limit);
}

export function getTestRun(id) {
  recoverInterruptedRuns();
  const db = getDb();
  const run = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id);
  if (!run) return null;
  return {
    ...run,
    cases: db.prepare('SELECT test_case_id, test_name, test_file, status, duration_ms, output FROM test_run_cases WHERE run_id = ? ORDER BY test_file, test_name').all(id),
  };
}

function runNode(args, root) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, FORCE_COLOR: '0' } });
    let output = '';
    const append = (chunk) => { output = `${output}${chunk}`.slice(-100_000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => resolve({ code: 1, output: error.message, durationMs: Date.now() - started }));
    child.on('close', (code) => resolve({ code: code ?? 1, output, durationMs: Date.now() - started }));
  });
}

function createTestWorkspace(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return { root, cleanup: () => {} };
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-test-run-'));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', workspace, 'HEAD'], { cwd: root, stdio: 'pipe' });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
    return {
      root: workspace,
      cleanup: () => execFileSync('git', ['worktree', 'remove', '--force', workspace], { cwd: root, stdio: 'pipe' }),
    };
  } catch (error) {
    fs.rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

function summary(output, code, selectedCount = null) {
  const count = (name) => Number(output.match(new RegExp(`# ${name} (\\d+)`))?.[1] || 0);
  return {
    status: code === 0 ? 'passed' : 'failed',
    passed: selectedCount ?? count('pass'),
    failed: code === 0 ? 0 : Math.max(1, count('fail')),
    skipped: selectedCount === null ? count('skipped') : 0,
  };
}

async function completeRun(runId, scope, selections, root) {
  const db = getDb();
  const workspace = createTestWorkspace(root);
  let output = '';
  let durationMs = 0;
  let result;
  const insertCase = db.prepare(`
    INSERT INTO test_run_cases (id, run_id, test_case_id, test_name, test_file, status, duration_ms, output, completed_at)
    VALUES (@id, @run_id, @test_case_id, @test_name, @test_file, @status, @duration_ms, @output, @completed_at)
  `);

  try {
    if (scope === 'selected') {
      let passed = 0;
      let failed = 0;
      for (const item of selections) {
        const test = await runNode(['--test', `--test-name-pattern=^${escapePattern(item.name)}$`, item.file], workspace.root);
        const status = test.code === 0 ? 'passed' : 'failed';
        passed += status === 'passed' ? 1 : 0;
        failed += status === 'failed' ? 1 : 0;
        durationMs += test.durationMs;
        output = `${output}\n\n[${item.file}: ${item.name}]\n${test.output}`.slice(-100_000);
        insertCase.run({ id: randomUUID(), run_id: runId, test_case_id: item.id, test_name: item.name, test_file: item.file, status, duration_ms: test.durationMs, output: test.output.slice(-25_000), completed_at: new Date().toISOString() });
      }
      result = { status: failed ? 'failed' : 'passed', passed, failed, skipped: 0 };
    } else {
      const args = scope === 'suite' ? ['--test', selections[0].file] : ['--test'];
      const test = await runNode(args, workspace.root);
      output = test.output;
      durationMs = test.durationMs;
      result = summary(test.output, test.code);
    }
  } finally {
    workspace.cleanup();
  }

  db.prepare(`
    UPDATE test_runs SET status = ?, completed_at = ?, duration_ms = ?, passed_count = ?, failed_count = ?, skipped_count = ?, output = ?
    WHERE id = ?
  `).run(result.status, new Date().toISOString(), durationMs, result.passed, result.failed, result.skipped, output, runId);
  activeRunId = null;
}

export function startTestRun({ scope, testCaseIds = [], suiteFile = '', requestedBy = '' }, root = process.cwd()) {
  if (activeRunId) throw new Error('A test run is already in progress');
  const cases = listTestCases(root);
  let selections = [];
  if (scope === 'selected') {
    const requested = new Set(testCaseIds);
    selections = cases.filter((item) => requested.has(item.id));
    if (!selections.length || selections.length !== requested.size) throw new Error('Select one or more valid test cases');
  } else if (scope === 'suite') {
    if (!testFiles(root).includes(suiteFile)) throw new Error('Select a valid test suite');
    selections = [{ file: suiteFile }];
  } else if (scope !== 'all') {
    throw new Error('Invalid test run scope');
  }
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO test_runs (id, scope, status, requested_by, started_at)
    VALUES (?, ?, 'running', ?, ?)
  `).run(id, scope, requestedBy, new Date().toISOString());
  activeRunId = id;
  void completeRun(id, scope, selections, root).catch((error) => {
    getDb().prepare("UPDATE test_runs SET status = 'failed', completed_at = ?, output = ? WHERE id = ?")
      .run(new Date().toISOString(), error.stack || error.message, id);
    activeRunId = null;
  });
  return getTestRun(id);
}
