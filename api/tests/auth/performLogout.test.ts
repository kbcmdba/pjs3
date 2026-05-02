import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { performLogout } from '../../src/auth/logout';
import { parseDatabaseUrl } from '../../src/db';
import { withTestDb } from '../helpers/testDb';

interface SessionRow {
  sessionId: number;
  userId: number;
  jti: string;
}

/**
 * Insert the minimum row chain needed for a `session` row:
 *   user → workspace → workspaceMember(role=Owner) → session.
 *
 * Returns the jti and the userId. Local helper because performLogout's
 * unit tests need to populate the `session` table directly without
 * going through signup → verify → login (those flows are tested
 * elsewhere; this file is testing performLogout in isolation).
 */
async function seedSession(
  databaseUrl: string,
  email: string,
): Promise<{ jti: string; userId: number; workspaceId: number }> {
  const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
  try {
    const [userResult] = await conn.query<mysql.ResultSetHeader>(
      'INSERT INTO `user` (email, passwordHash, emailVerifiedAt) VALUES (?, ?, NOW())',
      [email, 'placeholder-hash'],
    );
    const userId = userResult.insertId;

    const [wsResult] = await conn.query<mysql.ResultSetHeader>(
      'INSERT INTO `workspace` (name) VALUES (?)',
      [email.split('@')[0]],
    );
    const workspaceId = wsResult.insertId;

    const [[role]] = await conn.query(
      'SELECT workspaceRoleId FROM `workspaceRole` WHERE role = ?',
      ['Owner'],
    ) as unknown as [Array<{ workspaceRoleId: number }>, unknown];
    const workspaceRoleId = role!.workspaceRoleId;

    await conn.query(
      'INSERT INTO `workspaceMember` (workspaceId, userId, workspaceRoleId) VALUES (?, ?, ?)',
      [workspaceId, userId, workspaceRoleId],
    );

    const jti = randomUUID();
    await conn.query(
      'INSERT INTO `session` (userId, jti, currentWorkspaceId, currentRoleId, expiresAt) VALUES (?, ?, ?, ?, ?)',
      [userId, jti, workspaceId, workspaceRoleId, new Date(Date.now() + 3600_000)],
    );

    return { jti, userId, workspaceId };
  } finally {
    await conn.end();
  }
}

async function countSessions(databaseUrl: string, jti: string): Promise<number> {
  const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
  try {
    const [[row]] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM `session` WHERE jti = ?',
      [jti],
    ) as unknown as [Array<{ cnt: number }>, unknown];
    return row!.cnt;
  } finally {
    await conn.end();
  }
}

/**
 * DB-touching unit tests on `performLogout`. Bypass HTTP, JWT, and the
 * full auth flow — populate the `session` table directly and assert
 * performLogout's DELETE has the correct predicate and the correct
 * return shape.
 *
 * Coverage invariant: the integration test for /auth/logout doesn't
 * exercise these. A bug like `DELETE WHERE userId=?` (instead of
 * `WHERE jti=?`) needs to fail HERE, not in integration.
 */
describe('performLogout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('deletes the matching session row and returns ok=true', async () => {
    await withTestDb(async (databaseUrl) => {
      const { jti } = await seedSession(databaseUrl, 'a@example.com');

      const result = await performLogout(databaseUrl, jti);
      expect(result.ok).toBe(true);
      expect(await countSessions(databaseUrl, jti)).toBe(0);
    });
  });

  it('returns ok=false and changes nothing when the jti does not exist', async () => {
    await withTestDb(async (databaseUrl) => {
      const { jti: realJti } = await seedSession(databaseUrl, 'a@example.com');
      const ghostJti = randomUUID();

      const result = await performLogout(databaseUrl, ghostJti);
      expect(result.ok).toBe(false);
      // The unrelated real session is untouched.
      expect(await countSessions(databaseUrl, realJti)).toBe(1);
    });
  });

  it('preserves other sessions for the same user (catches DELETE WHERE userId=? bugs)', async () => {
    await withTestDb(async (databaseUrl) => {
      const { jti: jtiA, userId, workspaceId } = await seedSession(databaseUrl, 'shared@example.com');

      // Add a second session for the SAME user.
      const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
      let jtiB: string;
      try {
        const [[role]] = await conn.query(
          'SELECT workspaceRoleId FROM `workspaceRole` WHERE role = ?',
          ['Owner'],
        ) as unknown as [Array<{ workspaceRoleId: number }>, unknown];
        jtiB = randomUUID();
        await conn.query(
          'INSERT INTO `session` (userId, jti, currentWorkspaceId, currentRoleId, expiresAt) VALUES (?, ?, ?, ?, ?)',
          [userId, jtiB, workspaceId, role!.workspaceRoleId, new Date(Date.now() + 3600_000)],
        );
      } finally {
        await conn.end();
      }

      const result = await performLogout(databaseUrl, jtiA);
      expect(result.ok).toBe(true);
      expect(await countSessions(databaseUrl, jtiA)).toBe(0);
      expect(await countSessions(databaseUrl, jtiB)).toBe(1);
    });
  });

  /**
   * performLogout deletes by jti regardless of session.expiresAt.
   *
   * The JWT's exp is checked upstream by `verifyJwt`; performLogout never
   * sees an expired-JWT scenario in production. But the function's
   * behavior on a session row with past expiresAt (e.g., admin-revoked
   * session, clock skew) must be defined: just delete it. Pinning the
   * behavior here so a future refactor that adds an expiresAt check would
   * fail this test and force the discussion.
   */
  it('deletes sessions whose expiresAt is in the past (no expiry-gate inside performLogout)', async () => {
    await withTestDb(async (databaseUrl) => {
      const { jti } = await seedSession(databaseUrl, 'expired@example.com');

      const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
      try {
        await conn.query(
          'UPDATE `session` SET expiresAt = ? WHERE jti = ?',
          [new Date(Date.now() - 60 * 60 * 1000), jti],
        );
      } finally {
        await conn.end();
      }

      const result = await performLogout(databaseUrl, jti);
      expect(result.ok).toBe(true);
      expect(await countSessions(databaseUrl, jti)).toBe(0);
    });
  });

  it('preserves sessions belonging to other users (catches no-WHERE-clause bugs)', async () => {
    await withTestDb(async (databaseUrl) => {
      const a = await seedSession(databaseUrl, 'user-a@example.com');
      const b = await seedSession(databaseUrl, 'user-b@example.com');

      const result = await performLogout(databaseUrl, a.jti);
      expect(result.ok).toBe(true);
      expect(await countSessions(databaseUrl, a.jti)).toBe(0);
      expect(await countSessions(databaseUrl, b.jti)).toBe(1);
    });
  });
});
