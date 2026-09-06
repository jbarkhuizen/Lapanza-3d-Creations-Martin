import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  buildInstructionFilename,
  listInstructionFiles,
  deleteInstructionFile,
  ensureInstructionsDir,
} from './instruction-files.js';

// The module resolves its directory from process.cwd() per call, so each
// test runs inside its own temp cwd and never touches the real repo's
// public/uploads (same isolation concern as the generate-pages sandbox rule).
function inTempCwd(fn) {
  const prev = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-test-'));
  process.chdir(dir);
  try {
    fn(dir);
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('buildInstructionFilename sanitizes names and never trusts the client extension', () => {
  inTempCwd(() => {
    assert.strictEqual(buildInstructionFilename('Spacer Fitting A4.pdf'), 'spacer-fitting-a4.pdf');
    assert.strictEqual(buildInstructionFilename('../..\\evil name!.exe'), 'evil-name.pdf');
    assert.strictEqual(buildInstructionFilename(''), 'instructions.pdf');
  });
});

test('buildInstructionFilename adds a hash suffix instead of overwriting an existing file', () => {
  inTempCwd(() => {
    const dir = ensureInstructionsDir();
    fs.writeFileSync(path.join(dir, 'card.pdf'), 'x');
    const next = buildInstructionFilename('card.pdf');
    assert.notStrictEqual(next, 'card.pdf');
    assert.match(next, /^card-[0-9a-f]{6}\.pdf$/);
  });
});

test('listInstructionFiles and deleteInstructionFile round-trip; traversal is blocked', () => {
  inTempCwd(() => {
    assert.deepStrictEqual(listInstructionFiles(), []); // no dir yet
    const dir = ensureInstructionsDir();
    fs.writeFileSync(path.join(dir, 'b-card.pdf'), 'bbb');
    fs.writeFileSync(path.join(dir, 'a-card.pdf'), 'aa');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const files = listInstructionFiles();
    assert.deepStrictEqual(files.map((f) => f.filename), ['a-card.pdf', 'b-card.pdf']);
    assert.strictEqual(files[0].size, 2);
    assert.ok(files[0].uploadedAt);

    // Traversal / non-pdf deletes refused.
    fs.writeFileSync(path.join(dir, '..', 'outside.pdf'), 'x');
    assert.strictEqual(deleteInstructionFile('../outside.pdf'), false);
    assert.ok(fs.existsSync(path.join(dir, '..', 'outside.pdf')), 'file outside the dir must survive');
    assert.strictEqual(deleteInstructionFile('notes.txt'), false);

    assert.strictEqual(deleteInstructionFile('a-card.pdf'), true);
    assert.deepStrictEqual(listInstructionFiles().map((f) => f.filename), ['b-card.pdf']);
    assert.strictEqual(deleteInstructionFile('a-card.pdf'), false); // already gone
  });
});
