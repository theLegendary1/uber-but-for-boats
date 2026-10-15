import { readFileSync, writeFileSync } from 'node:fs';
import { flavorMessage } from './versioning.js';
const path = process.argv[2];
try {
  const message = readFileSync(path, 'utf8').split('\n').filter((line) => !line.startsWith('#')).join('\n');
  writeFileSync(path, flavorMessage(message) + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
