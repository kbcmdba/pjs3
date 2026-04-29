import { expect } from 'vitest';
import type { Connection, ResultSetHeader } from 'mysql2/promise';

const HARNESS_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS \`_pjs3_test_fixture_catalog\` (
    fixtureCatalogId INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(255) NOT NULL,
    UNIQUE KEY (name)
  )`,
  `CREATE TABLE IF NOT EXISTS \`_pjs3_test_fixture_log\` (
    fixtureLogId     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    fixtureCatalogId INT UNSIGNED NOT NULL,
    test_name        VARCHAR(255) NULL,
    created_at       DATETIME(6) NOT NULL,
    load_time_ms     INT UNSIGNED NULL,
    FOREIGN KEY (fixtureCatalogId) REFERENCES \`_pjs3_test_fixture_catalog\`(fixtureCatalogId)
  )`,
];

export async function createHarnessTables(conn: Connection): Promise<void> {
  for (const sql of HARNESS_TABLES_SQL) {
    await conn.query(sql);
  }
}

async function upsertFixtureName(conn: Connection, name: string): Promise<number> {
  const [result] = await conn.query<ResultSetHeader>(
    `INSERT INTO \`_pjs3_test_fixture_catalog\` (name) VALUES (?)
     ON DUPLICATE KEY UPDATE fixtureCatalogId = LAST_INSERT_ID(fixtureCatalogId)`,
    [name],
  );
  return result.insertId;
}

export async function withFixture<T>(
  name: string,
  conn: Connection,
  apply: (conn: Connection) => Promise<T>,
): Promise<T> {
  const testName = expect.getState().currentTestName ?? null;
  const createdAt = new Date();

  const fixtureCatalogId = await upsertFixtureName(conn, name);

  const [insertResult] = await conn.query<ResultSetHeader>(
    `INSERT INTO \`_pjs3_test_fixture_log\`
       (fixtureCatalogId, test_name, created_at)
     VALUES (?, ?, ?)`,
    [fixtureCatalogId, testName, createdAt],
  );
  const fixtureLogId = insertResult.insertId;

  const startMs = performance.now();
  const result = await apply(conn);
  const loadTimeMs = Math.round(performance.now() - startMs);

  await conn.query(
    `UPDATE \`_pjs3_test_fixture_log\` SET load_time_ms = ? WHERE fixtureLogId = ?`,
    [loadTimeMs, fixtureLogId],
  );

  return result;
}
