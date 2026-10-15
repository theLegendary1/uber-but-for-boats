import { execFileSync } from 'node:child_process';
try {
  const files = ['package.json', 'package-lock.json', 'CHANGELOG.md'];
  const dirty = execFileSync('git', ['diff', '--name-only', '--', ...files], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`Stage or stash ${dirty.replaceAll('\n', ', ')} first; automatic versioning will not overwrite unstaged edits.`);
  for (const file of files.slice(0, 2)) JSON.parse(execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
