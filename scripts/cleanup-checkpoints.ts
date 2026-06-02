import {
  cleanupOldCheckpoints,
  createPostgresCheckpointer,
} from '../src/orchestrator/index.js';

const olderThanDays = Number(process.env.CHECKPOINT_TTL_DAYS ?? 30);
if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
  process.stderr.write(
    `CHECKPOINT_TTL_DAYS must be a positive number; got "${process.env.CHECKPOINT_TTL_DAYS}".\n`,
  );
  process.exit(1);
}

const handle = await createPostgresCheckpointer();
try {
  const result = await cleanupOldCheckpoints({
    saver: handle.saver,
    pool: handle.pool,
    olderThanDays,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        olderThanDays,
        deletedThreadCount: result.deletedThreads.length,
        deletedThreads: result.deletedThreads,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await handle.close();
}
