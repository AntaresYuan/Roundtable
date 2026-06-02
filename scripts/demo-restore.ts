import { resolve } from 'node:path';
import { createDbClient } from '../src/db/client.js';
import {
  assertDemoRestoreAllowed,
  loadDemoSeed,
  restoreDemo,
} from '../src/lib/demo-restore.js';

const fixturePath = resolve(
  process.env['DEMO_SEED_PATH'] ?? 'tests/fixtures/demo/seed.json',
);

assertDemoRestoreAllowed();

const { db, client } = createDbClient();
try {
  const seed = await loadDemoSeed(fixturePath);
  await restoreDemo(db, seed);
  process.stdout.write(
    `${JSON.stringify(
      {
        fixturePath,
        users: seed.users.length,
        chats: seed.chats.length,
        messages: seed.messages.length,
        artifacts: seed.artifacts.length,
        handoffs: seed.handoffs.length,
        pinnedMessages: seed.pinnedMessages.length,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.end();
}
