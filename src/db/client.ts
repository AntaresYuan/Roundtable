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

export type DbClient = ReturnType<typeof createDbClient>;
export type Db = DbClient['db'];
