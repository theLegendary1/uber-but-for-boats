import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { bumpVersion, flavorMessage } from './versioning.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
try {
  const message = git('show', '-s', '--format=%B', 'HEAD');
  if (git('diff', '--cached', '--name-only')) throw new Error('Other staged work remains after this commit. Use a normal staged commit; finalization will not include unrelated staged files.');
  const files = ['package.json', 'package-lock.json', 'CHANGELOG.md'];
  for (const file of files) {
    if (git('diff', '--name-only', '--', file)) throw new Error(`Stage or stash changes to ${file} first; automatic versioning will not overwrite unstaged edits.`);
  }
  const pkg = JSON.parse(git('show', ':package.json'));
  const lock = JSON.parse(git('show', ':package-lock.json'));
  let previous;
  try { previous = JSON.parse(git('show', 'HEAD^:package.json')).version; }
  catch { previous = pkg.version; }
  const version = bumpVersion(previous, message);
  pkg.version = lock.version = lock.packages[''].version = version;
  let changelog;
  try { changelog = git('show', ':CHANGELOG.md'); }
  catch { changelog = '# Changelog\n\nDerek’s release ledger: every commit moves the operation forward.\n'; }
  const lines = changelog.split('\n');
  const introEnd = lines.findIndex((line) => /^## \[/.test(line));
  const cut = introEnd < 0 ? lines.length : introEnd;
  const entry = `## [${version}] - ${new Date().toISOString().slice(0, 10)}\n\n- ${message.split('\n')[0]}\n`;
  const nextLog = `${lines.slice(0, cut).join('\n').trimEnd()}\n\n${entry}\n${lines.slice(cut).join('\n')}`.trimEnd() + '\n';
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  writeFileSync('CHANGELOG.md', nextLog);
  git('add', '--', ...files);
  git('-c', 'core.hooksPath=/dev/null', 'commit', '--amend', '--no-edit', '--no-verify');
  console.log(`DockWash ${previous} → ${version}: version and release notes included in the finalized commit.`);
} catch (error) {
  console.error(`Automatic versioning: ${error.message}`);
  process.exitCode = 1;
}
