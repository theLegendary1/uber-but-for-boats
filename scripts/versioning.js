export function bumpVersion(version, message) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Expected a stable semantic version, got ${version}`);
  let [major, minor, patch] = version.split('.').map(Number);
  if (/^[\w-]+(?:\([^\n)]+\))?!:/.test(message) || /^BREAKING[ -]CHANGE:\s*\S/m.test(message)) return `${major + 1}.0.0`;
  if (/^feat(?:\([^\n)]+\))?:/.test(message)) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function flavorMessage(message) {
  const [subject, ...body] = message.trim().split('\n');
  if (!subject) throw new Error('A commit message is required.');
  if (/\[(?:Dale|Brennan|Derek|Robert|Nancy): [^\]\n]+\]$/.test(subject)) return message.trim();
  const type = subject.match(/^([\w-]+)(?:\([^)]*\))?!?:/)?.[1];
  const line = {
    feat: 'Dale: More room for dockside activities.',
    fix: 'Robert: The schedule needs adult supervision.',
    test: 'Robert: Evidence before the victory lap.',
    docs: 'Brennan: Put the plan in writing.',
    chore: 'Derek: Keep the operation moving.',
  }[type] || 'Nancy: Keep the crew working together.';
  return [`${subject} [${line}]`, ...body].join('\n');
}
