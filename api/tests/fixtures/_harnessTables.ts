import type { Connection } from 'mysql2/promise';

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

/**
 * Create the harness tables (fixture catalog + fixture log) on the given
 * connection. Split from `_harness.ts` so it can be called from
 * `tests/globalSetup.ts`, which runs outside the vitest worker context and
 * therefore cannot import `vitest`'s `expect`.
 */
export async function createHarnessTables(conn: Connection): Promise<void> {
  for (const sql of HARNESS_TABLES_SQL) {
    await conn.query(sql);
  }
}
