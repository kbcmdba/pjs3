import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { parseDatabaseUrl } from '../../src/db';

const CONNECT_TIMEOUT_MS = 5000;

function randomDbName(): string {
  return `pjs3_test_${randomBytes(6).toString('hex')}`;
}

function appendDb(baseUrl: string, dbName: string): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${trimmed}${dbName}`;
}

/**
 * Run `fn` against a freshly-cloned test database.
 *
 * Cloning shape (post-PR #38):
 *   1. CREATE DATABASE pjs3_test_<random>.
 *   2. Apply the cached schema dump (single multi-statement query —
 *      ~22 CREATE TABLE statements bracketed by FOREIGN_KEY_CHECKS=0/1).
 *   3. Copy seed + harness data from the template via cross-database
 *      INSERT ... SELECT (works because both DBs match the
 *      `pjs3_test_%` grant on the test user).
 *   4. Run `fn` against the cloned DB.
 *   5. DROP DATABASE pjs3_test_<random>.
 *
 * Schema and seed data come from the template DB built once in
 * `tests/globalSetup.ts`. Per-test cost dropped from ~25s (drizzle-kit
 * migrator running every statement separately against mysql2.hole) to
 * ~1s (one schema-dump replay + small data copy).
 */
export async function withTestDb<T>(
  fn: (databaseUrl: string) => Promise<T>,
): Promise<T> {
  const bootstrapUrl = process.env.TEST_BOOTSTRAP_DATABASE_URL;
  const userUrlBase = process.env.TEST_DATABASE_URL_BASE;
  const templateName = process.env.PJS3_TEMPLATE_DB_NAME;
  const schemaDump = process.env.PJS3_SCHEMA_DUMP;

  if (!bootstrapUrl || !userUrlBase || !templateName || !schemaDump) {
    throw new Error(
      'Test env not initialized. Did vitest globalSetup run? ' +
        'Required: TEST_BOOTSTRAP_DATABASE_URL, TEST_DATABASE_URL_BASE, ' +
        'PJS3_TEMPLATE_DB_NAME, PJS3_SCHEMA_DUMP.',
    );
  }

  const dbName = randomDbName();
  const userUrl = appendDb(userUrlBase, dbName);

  const bootstrap = await mysql.createConnection(
    parseDatabaseUrl(bootstrapUrl, CONNECT_TIMEOUT_MS),
  );
  try {
    await bootstrap.query(`CREATE DATABASE \`${dbName}\``);
  } finally {
    await bootstrap.end();
  }

  try {
    const userConn = await mysql.createConnection({
      ...parseDatabaseUrl(userUrl, CONNECT_TIMEOUT_MS),
      multipleStatements: true,
    });
    try {
      await userConn.query(schemaDump);

      const [tableRows] = await userConn.query(
        "SELECT TABLE_NAME FROM information_schema.tables " +
          "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
        [dbName],
      );
      await userConn.query('SET FOREIGN_KEY_CHECKS=0');
      for (const row of tableRows as Array<{ TABLE_NAME: string }>) {
        await userConn.query(
          `INSERT INTO \`${dbName}\`.\`${row.TABLE_NAME}\` ` +
            `SELECT * FROM \`${templateName}\`.\`${row.TABLE_NAME}\``,
        );
      }
      await userConn.query('SET FOREIGN_KEY_CHECKS=1');
    } finally {
      await userConn.end();
    }

    return await fn(userUrl);
  } finally {
    const dropConn = await mysql.createConnection(
      parseDatabaseUrl(bootstrapUrl, CONNECT_TIMEOUT_MS),
    );
    try {
      await dropConn.query(`DROP DATABASE \`${dbName}\``);
    } finally {
      await dropConn.end();
    }
  }
}
