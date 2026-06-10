import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const DEFAULT_DATABASE_URL =
  'postgres://roundtable:roundtable@localhost:5432/roundtable';

export function createDbClient(databaseUrl = process.env.DATABASE_URL) {
  const client = postgres(databaseUrl ?? DEFAULT_DATABASE_URL, {
    max: 10,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

// Singleton — survives Next.js hot-reload in dev so we don't leak a new
// connection pool on every tRPC request.
const g = globalThis as typeof globalThis & { _rtDbClient?: DbClient };
export function getDbClient(): DbClient {
  if (!g._rtDbClient) {
    g._rtDbClient = createDbClient();
  }
  return g._rtDbClient;
}

export type DbClient = ReturnType<typeof createDbClient>;
export type Db = DbClient['db'];
