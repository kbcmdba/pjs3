// Load .env vars first (same logic as `setup-env.ts`, which runs in workers
// only — globalSetup runs in the parent process and needs its own pass).
import './setup-env';

import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { parseDatabaseUrl } from '../src/db';
import { seedReferenceData } from '../src/seed/referenceData';
import { createHarnessTables } from './fixtures/_harnessTables';

const MIGRATIONS_FOLDER = './drizzle';
const CONNECT_TIMEOUT_MS = 5000;

function appendDb(baseUrl: string, dbName: string): string {
  const trimmed = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${trimmed}${dbName}`;
}

/**
 * Vitest globalSetup: run once before any worker spawns. Build a fully-
 * migrated + seeded "template" database, then capture its schema as a
 * single multi-statement SQL dump that workers can replay against fresh
 * test DBs (much faster than re-running drizzle-kit's per-statement
 * migrator on every test).
 *
 * Per-test work in `withTestDb()` becomes:
 *   1. CREATE DATABASE pjs3_test_<random>
 *   2. Apply the cached schema dump (one round-trip).
 *   3. Copy seed + harness data from the template via INSERT ... SELECT
 *      (cross-database -- works because both DBs match the
 *      `pjs3_test_%` grant on the test user).
 *
 * Workers receive the template name and schema dump via env vars set
 * here; vitest's main process spawns workers via fork, which inherit
 * env from the parent.
 *
 * Why a schema dump instead of `CREATE TABLE LIKE`: `CREATE TABLE LIKE`
 * does NOT copy foreign-key constraints (MySQL docs are explicit). The
 * test DBs need the same FK behavior as production, so the dump is the
 * only correct approach. `SHOW CREATE TABLE` returns the full DDL
 * including FKs.
 *
 * Template DB is named `pjs3_test_template_<hex>` to match the existing
 * grant on `pjs3_test_%.*` -- avoids needing a new grant.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const bootstrapUrl = process.env.TEST_BOOTSTRAP_DATABASE_URL;
  const userUrlBase = process.env.TEST_DATABASE_URL_BASE;
  if (!bootstrapUrl || !userUrlBase) {
    throw new Error(
      'TEST_BOOTSTRAP_DATABASE_URL and TEST_DATABASE_URL_BASE must be set. See api/env.example.',
    );
  }

  const templateName = `pjs3_test_template_${randomBytes(6).toString('hex')}`;

  const bootstrap = await mysql.createConnection(
    parseDatabaseUrl(bootstrapUrl, CONNECT_TIMEOUT_MS),
  );
  try {
    await bootstrap.query(`CREATE DATABASE \`${templateName}\``);
  } finally {
    await bootstrap.end();
  }

  const templateUrl = appendDb(userUrlBase, templateName);
  const userConn = await mysql.createConnection(
    parseDatabaseUrl(templateUrl, CONNECT_TIMEOUT_MS),
  );
  try {
    const db = drizzle(userConn);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await seedReferenceData(db);
    await createHarnessTables(userConn);
  } finally {
    await userConn.end();
  }

  // Capture the schema as a single multi-statement string. FOREIGN_KEY_CHECKS
  // is disabled around the CREATE TABLE block so order doesn't matter — the
  // FKs resolve correctly once all tables exist.
  const dumpConn = await mysql.createConnection(
    parseDatabaseUrl(bootstrapUrl, CONNECT_TIMEOUT_MS),
  );
  let schemaDump: string;
  try {
    const [tableRows] = await dumpConn.query(
      "SELECT TABLE_NAME FROM information_schema.tables " +
        "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
      [templateName],
    );

    const stmts: string[] = ['SET FOREIGN_KEY_CHECKS=0'];
    for (const row of tableRows as Array<{ TABLE_NAME: string }>) {
      const [createRows] = await dumpConn.query(
        `SHOW CREATE TABLE \`${templateName}\`.\`${row.TABLE_NAME}\``,
      );
      const createStmt = (createRows as Array<Record<string, string>>)[0]!['Create Table']!;
      stmts.push(createStmt);
    }
    stmts.push('SET FOREIGN_KEY_CHECKS=1');
    schemaDump = stmts.join(';\n') + ';\n';
  } finally {
    await dumpConn.end();
  }

  process.env.PJS3_TEMPLATE_DB_NAME = templateName;
  process.env.PJS3_SCHEMA_DUMP = schemaDump;

  return async () => {
    const dropConn = await mysql.createConnection(
      parseDatabaseUrl(bootstrapUrl, CONNECT_TIMEOUT_MS),
    );
    try {
      await dropConn.query(`DROP DATABASE \`${templateName}\``);
    } finally {
      await dropConn.end();
    }
  };
}
