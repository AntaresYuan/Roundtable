import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'tests', 'scripts', 'examples'];
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
  'workspaces',
]);
// Debug-only demo/probe tooling legitimately writes to stdout — the very
// "debug-only paths" the violation message exempts. Matched by relative path so
// only scripts/demo is skipped, not every directory that happens to be named
// "demo".
const SKIP_PATHS = ['scripts/demo'];
const LOG_PATTERN = new RegExp(`console[.]${'log'}\\s*\\(`);

const violations = [];

for (const dir of SCAN_DIRS) {
  await scan(join(ROOT, dir));
}

if (violations.length > 0) {
  process.stderr.write(
    [
      'console.log is blocked outside debug-only paths.',
      ...violations.map((path) => `- ${path}`),
      '',
    ].join('\n'),
  );
  process.exit(1);
}

async function scan(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const rel = relative(ROOT, child).split('\\').join('/');
      if (SKIP_PATHS.includes(rel)) continue;
      await scan(child);
      continue;
    }

    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;

    const text = await readFile(child, 'utf8');
    if (LOG_PATTERN.test(text)) {
      violations.push(relative(ROOT, child));
    }
  }
}
