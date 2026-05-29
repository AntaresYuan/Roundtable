import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('drizzle.config.ts') && !existsSync('drizzle.config.mjs')) {
  process.stdout.write(
    'No Drizzle config found yet; skipping migrations until issue #35 lands.\n',
  );
  process.exit(0);
}

const result = spawnSync('corepack', ['pnpm', 'drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
