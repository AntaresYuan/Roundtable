import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('scripts/seed.ts') && !existsSync('scripts/seed.mjs')) {
  process.stdout.write(
    'No seed script found yet; skipping seed data until issue #35 lands.\n',
  );
  process.exit(0);
}

const target = existsSync('scripts/seed.ts') ? 'scripts/seed.ts' : 'scripts/seed.mjs';
const command = target.endsWith('.ts') ? ['tsx', target] : ['node', target];

const result = spawnSync('corepack', ['pnpm', ...command], {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
