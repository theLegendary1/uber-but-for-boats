import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
if (existsSync('.git')) {
  let current = '';
  try { current = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (error) { if (error.status !== 1) throw error; }
  if (current && current !== '.githooks') throw new Error(`Existing hooksPath is ${current}; merge its hooks before switching to .githooks.`);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
  console.log('DockWash versioning hook installed.');
}
