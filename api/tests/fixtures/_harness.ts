import { expect } from 'vitest';
import type { Connection, ResultSetHeader } from 'mysql2/promise';

// Table-creation logic moved to `_harnessTables.ts` so `tests/globalSetup.ts`
// can import it without pulling in the vitest runtime (`expect` is unavailable
// in globalSetup's parent-process context).
export { createHarnessTables } from './_harnessTables';

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
