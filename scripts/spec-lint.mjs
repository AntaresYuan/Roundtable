import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SPECS_DIR = 'specs';
const SPEC_STEP = 10;

const failures = [
  ...(await checkSpecNumbers()),
  ...(await checkAgentEventDocumentation()),
];

if (failures.length > 0) {
  process.stderr.write(['spec:lint failed:', ...failures.map((f) => `- ${f}`), ''].join('\n'));
  process.exit(1);
}

async function checkSpecNumbers() {
  const files = (await readdir(SPECS_DIR))
    .filter((file) => file.endsWith('.md'))
    .sort();
  const failures = [];
  const numbered = [];

  for (const file of files) {
    const match = /^(\d{3})-[a-z0-9-]+[.]md$/.exec(file);
    if (!match) {
      failures.push(`${SPECS_DIR}/${file} must match NNN-topic.md`);
      continue;
    }
    numbered.push({ file, number: Number(match[1]) });
  }

  numbered.forEach(({ file, number }, index) => {
    const expected = index * SPEC_STEP;
    if (number !== expected) {
      failures.push(
        `${SPECS_DIR}/${file} is ${formatNumber(number)}; expected ${formatNumber(expected)}`,
      );
    }
  });

  return failures;
}

async function checkAgentEventDocumentation() {
  const eventSource = await readFile('src/contracts/event.ts', 'utf8');
  const spec020 = await readFile(join(SPECS_DIR, '020-adapter-protocol.md'), 'utf8');
  const eventNames = Array.from(
    eventSource.matchAll(/type:\s*z[.]literal\(['"]([^'"]+)['"]\)/g),
    (match) => match[1],
  );

  return eventNames
    .filter((eventName) => !spec020.includes(`\`${eventName}\``))
    .map((eventName) => `AgentEvent variant \`${eventName}\` is missing from specs/020-adapter-protocol.md`);
}

function formatNumber(number) {
  return String(number).padStart(3, '0');
}
