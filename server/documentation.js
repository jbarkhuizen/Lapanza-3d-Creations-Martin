import fs from 'fs';
import path from 'path';

function markdownFiles(dir, root) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(file, root);
    return entry.isFile() && entry.name.endsWith('.md') ? [path.relative(root, file)] : [];
  });
}

function metadata(root, relativePath) {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = lines.find((line) => line.startsWith('# '))?.slice(2) || path.basename(relativePath, '.md');
  const description = lines.find((line) => !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('---')) || '';
  return {
    id: Buffer.from(relativePath).toString('base64url'),
    path: relativePath.split(path.sep).join('/'),
    title,
    description,
    // Review #3 (todo #142): file mtime -- on the VPS this is when the file
    // last changed on THAT server (a git pull stamps pull time), which is
    // exactly the "how fresh is what I'm reading here" question being asked.
    updatedAt: fs.statSync(path.join(root, relativePath)).mtime.toISOString(),
  };
}

export function listDocumentation(root = process.cwd()) {
  const files = [];
  if (fs.existsSync(path.join(root, 'README.md'))) files.push('README.md');
  files.push(...markdownFiles(path.join(root, 'docs'), root));
  return files.sort().map((relativePath) => metadata(root, relativePath));
}

export function getDocumentation(id, root = process.cwd()) {
  const document = listDocumentation(root).find((item) => item.id === id);
  if (!document) return null;
  return { ...document, content: fs.readFileSync(path.join(root, document.path), 'utf8') };
}
