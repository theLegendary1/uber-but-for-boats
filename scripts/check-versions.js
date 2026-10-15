import { execFileSync } from 'node:child_process';
import { bumpVersion, flavorMessage } from './versioning.js';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
try {
  const commits = git('rev-list', '--reverse', 'HEAD').split('\n').filter(Boolean);
  let checked = 0;
  for (const commit of commits) {
    const parents = git('show', '-s', '--format=%P', commit).split(' ').filter(Boolean);
    // The pre-automation initial import is the baseline; leave its history intact.
    if (!parents.length) continue;
    const message = git('show', '-s', '--format=%B', commit);
    const previous = JSON.parse(git('show', `${parents[0]}:package.json`)).version;
    const pkg = JSON.parse(git('show', `${commit}:package.json`));
    const lock = JSON.parse(git('show', `${commit}:package-lock.json`));
    const expected = bumpVersion(previous, message);
    if (pkg.version !== expected || lock.version !== expected || lock.packages[''].version !== expected) {
      throw new Error(`${commit.slice(0, 7)} must use version ${expected} in package.json and package-lock.json`);
    }
    if (flavorMessage(message) !== message.trim()) throw new Error(`${commit.slice(0, 7)} needs a cast-flavored commit subject`);
    if (!git('show', `${commit}:CHANGELOG.md`).includes(`## [${expected}]`)) throw new Error(`${commit.slice(0, 7)} needs a changelog entry for ${expected}`);
    checked++;
  }
  console.log(`Verified ${checked} versioned commits; initial import retained as baseline.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
