import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { withTestDb } from './helpers/testDb';
import { withFixture } from './fixtures/_harness';
import { applyWithCollaboratorRole } from './fixtures/withCollaboratorRole';

interface FixtureLogRow {
  id: number;
  fixture_id: number;
  test_name: string | null;
  created_at: Date;
  load_time_ms: number | null;
}

interface FixtureCatalogRow {
  id: number;
  name: string;
}

function parseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) || undefined,
  };
}

describe('withFixture', () => {
  it('inserts the fixture into the catalog and writes a completed log row', async () => {
    await withTestDb(async (databaseUrl) => {
      const conn = await mysql.createConnection(parseUrl(databaseUrl));
      try {
        await withFixture('with-collaborator-role', conn, applyWithCollaboratorRole);

        const [catalogRows] = await conn.query(
          'SELECT * FROM `_pjs3_test_fixture_catalog` WHERE name = ?',
          ['with-collaborator-role'],
        );
        const catalog = catalogRows as FixtureCatalogRow[];
        expect(catalog).toHaveLength(1);

        const [logRows] = await conn.query(
          'SELECT * FROM `_pjs3_test_fixture_log` WHERE fixture_id = ?',
          [catalog[0]!.id],
        );
        const log = logRows as FixtureLogRow[];
        expect(log).toHaveLength(1);
        expect(log[0]!.load_time_ms).not.toBeNull();
        expect(log[0]!.load_time_ms).toBeGreaterThanOrEqual(0);
        expect(log[0]!.test_name).toContain('completed log row');
      } finally {
        await conn.end();
      }
    });
  });

  it('records load_time_ms as NULL when the fixture throws mid-load', async () => {
    await withTestDb(async (databaseUrl) => {
      const conn = await mysql.createConnection(parseUrl(databaseUrl));
      try {
        await expect(
          withFixture('failing-fixture', conn, async () => {
            throw new Error('intentional fixture failure');
          }),
        ).rejects.toThrow('intentional fixture failure');

        const [catalogRows] = await conn.query(
          'SELECT * FROM `_pjs3_test_fixture_catalog` WHERE name = ?',
          ['failing-fixture'],
        );
        const catalog = catalogRows as FixtureCatalogRow[];
        expect(catalog).toHaveLength(1);

        const [logRows] = await conn.query(
          'SELECT * FROM `_pjs3_test_fixture_log` WHERE fixture_id = ?',
          [catalog[0]!.id],
        );
        const log = logRows as FixtureLogRow[];
        expect(log).toHaveLength(1);
        expect(log[0]!.load_time_ms).toBeNull();
      } finally {
        await conn.end();
      }
    });
  });

  it('upserts the catalog when a fixture is loaded twice in the same DB', async () => {
    await withTestDb(async (databaseUrl) => {
      const conn = await mysql.createConnection(parseUrl(databaseUrl));
      try {
        await withFixture('with-collaborator-role', conn, applyWithCollaboratorRole);
        // Second call: should reuse catalog entry, add a second log row.
        await withFixture('with-collaborator-role', conn, async () => {
          /* idempotent body, no DB writes -- just exercising the wrapper */
        });

        const [catalogRows] = await conn.query(
          'SELECT * FROM `_pjs3_test_fixture_catalog` WHERE name = ?',
          ['with-collaborator-role'],
        );
        expect((catalogRows as FixtureCatalogRow[]).length).toBe(1);

        const [logRows] = await conn.query(
          'SELECT COUNT(*) AS cnt FROM `_pjs3_test_fixture_log`',
        );
        expect((logRows as Array<{ cnt: number }>)[0]!.cnt).toBe(2);
      } finally {
        await conn.end();
      }
    });
  });
});
