import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { buildApp } from '../../src/server';
import { parseDatabaseUrl } from '../../src/db';
import { withTestDb } from '../helpers/testDb';

interface UserRow {
  userId: number;
  email: string;
  emailVerifiedAt: Date | null;
}

interface TokenRow {
  emailVerificationTokenId: number;
  userId: number;
  token: string;
  expiresAt: Date;
}

/**
 * Per ADR 0003 §"Email verification: hard gate":
 *
 * - Endpoint: POST /auth/verify-email
 * - Body: { token: '<64-char hex>' }
 * - Success: 200 { success: true }; sets user.emailVerifiedAt; deletes the consumed token row.
 * - Failure (any reason): 400 { error: 'invalid token' }. *Indistinguishable* across:
 *   missing field, malformed token, no such token, expired token, already-consumed token.
 *   This is account-enumeration defense — an attacker probing tokens must not learn
 *   *why* a token was rejected, only that it was.
 */
describe('POST /auth/verify-email - integration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('marks the user verified and deletes the token on a valid in-time token', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        // Sign up to get a real user + token in the DB.
        const signupResponse = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'verify-me@example.com', password: 'a-strong-password' },
        });
        expect(signupResponse.statusCode).toBe(201);

        // Read the freshly-issued token straight out of the DB.
        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        let token: string;
        let userIdBefore: number;
        try {
          const [userRows] = await conn.query(
            'SELECT * FROM `user` WHERE email = ?',
            ['verify-me@example.com'],
          );
          const users = userRows as UserRow[];
          expect(users).toHaveLength(1);
          expect(users[0]!.emailVerifiedAt).toBeNull();
          userIdBefore = users[0]!.userId;

          const [tokenRows] = await conn.query(
            'SELECT * FROM `emailVerificationToken` WHERE userId = ?',
            [userIdBefore],
          );
          const tokens = tokenRows as TokenRow[];
          expect(tokens).toHaveLength(1);
          token = tokens[0]!.token;
        } finally {
          await conn.end();
        }

        // Verify with the real token.
        const verifyResponse = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token },
        });
        expect(verifyResponse.statusCode).toBe(200);
        expect(verifyResponse.json()).toEqual({ success: true });

        // user.emailVerifiedAt is now set (within 60s of now — guards against
        // the timezone-offset class of bug we hit on expiresAt in PR #34, plus
        // hardcoded-default-timestamp bugs); the token row is gone.
        const conn2 = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [userRows] = await conn2.query(
            'SELECT * FROM `user` WHERE userId = ?',
            [userIdBefore],
          );
          const users = userRows as UserRow[];
          expect(users).toHaveLength(1);
          expect(users[0]!.emailVerifiedAt).toBeInstanceOf(Date);
          const actualVerifiedAt = users[0]!.emailVerifiedAt!.getTime();
          expect(Math.abs(actualVerifiedAt - Date.now())).toBeLessThan(60 * 1000);

          const [tokenRows] = await conn2.query(
            'SELECT COUNT(*) AS cnt FROM `emailVerificationToken` WHERE userId = ?',
            [userIdBefore],
          );
          expect((tokenRows as Array<{ cnt: number }>)[0]!.cnt).toBe(0);
        } finally {
          await conn2.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('rejects a replay of a successfully-consumed token (single-use enforcement)', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'replay@example.com', password: 'a-strong-password' },
        });

        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        let token: string;
        let userId: number;
        try {
          const [userRows] = await conn.query(
            'SELECT * FROM `user` WHERE email = ?',
            ['replay@example.com'],
          );
          userId = (userRows as UserRow[])[0]!.userId;
          const [tokenRows] = await conn.query(
            'SELECT * FROM `emailVerificationToken` WHERE userId = ?',
            [userId],
          );
          token = (tokenRows as TokenRow[])[0]!.token;
        } finally {
          await conn.end();
        }

        // First verify succeeds.
        const first = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token },
        });
        expect(first.statusCode).toBe(200);

        // Second verify with the same token is indistinguishable from "no such token".
        const second = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token },
        });
        expect(second.statusCode).toBe(400);
        expect(second.json()).toEqual({ error: 'invalid token' });

        // emailVerifiedAt remains set (the user is still verified from the first call).
        const conn2 = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [userRows] = await conn2.query(
            'SELECT * FROM `user` WHERE userId = ?',
            [userId],
          );
          expect((userRows as UserRow[])[0]!.emailVerifiedAt).not.toBeNull();
        } finally {
          await conn2.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('rejects an expired token without verifying the user', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        // Signup creates a token with a 24h-future expiresAt.
        await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'expired@example.com', password: 'a-strong-password' },
        });

        // Backdate the token's expiresAt to 1 hour ago (simulate stale token).
        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        let token: string;
        let userId: number;
        try {
          const [userRows] = await conn.query(
            'SELECT * FROM `user` WHERE email = ?',
            ['expired@example.com'],
          );
          userId = (userRows as UserRow[])[0]!.userId;

          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          await conn.query(
            'UPDATE `emailVerificationToken` SET expiresAt = ? WHERE userId = ?',
            [oneHourAgo, userId],
          );

          const [tokenRows] = await conn.query(
            'SELECT * FROM `emailVerificationToken` WHERE userId = ?',
            [userId],
          );
          token = (tokenRows as TokenRow[])[0]!.token;
        } finally {
          await conn.end();
        }

        const response = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid token' });

        // User was NOT verified.
        const conn2 = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [userRows] = await conn2.query(
            'SELECT * FROM `user` WHERE userId = ?',
            [userId],
          );
          expect((userRows as UserRow[])[0]!.emailVerifiedAt).toBeNull();
        } finally {
          await conn2.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('rejects a well-formed token that does not exist in the DB', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        // 64 valid hex chars but never issued. Same response shape as every other failure.
        const response = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token: 'a'.repeat(64) },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid token' });
      } finally {
        await app.close();
      }
    });
  });

  it('rejects a malformed token (wrong length / non-hex) with the same response shape', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        // Too short.
        const tooShort = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token: 'abc123' },
        });
        expect(tooShort.statusCode).toBe(400);
        expect(tooShort.json()).toEqual({ error: 'invalid token' });

        // Right length, non-hex characters ('z' is not a hex digit).
        const nonHex = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token: 'z'.repeat(64) },
        });
        expect(nonHex.statusCode).toBe(400);
        expect(nonHex.json()).toEqual({ error: 'invalid token' });
      } finally {
        await app.close();
      }
    });
  });

  it('rejects a missing token field with the same response shape', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: {},
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid token' });
      } finally {
        await app.close();
      }
    });
  });

  /**
   * Cross-user/cross-token isolation. Catches two specific bug classes the
   * single-user tests above silently tolerate:
   *
   *   1. Token deletion on the wrong predicate.
   *      `DELETE ... WHERE userId = ?` (instead of `WHERE token = ?`) would
   *      pass all the single-user tests because the verified user only has
   *      one token. Here we assert user B's unrelated token survives.
   *
   *   2. User-update on the wrong predicate.
   *      `UPDATE user SET emailVerifiedAt = NOW()` with no WHERE, or with the
   *      wrong WHERE, would pass all the single-user tests because there's
   *      only one user. Here we assert user B's emailVerifiedAt is still
   *      NULL after verifying A.
   */
  it('verifying user A leaves user B unverified and B\'s token intact', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'user-a@example.com', password: 'a-strong-password' },
        });
        await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'user-b@example.com', password: 'b-strong-password' },
        });

        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        let tokenA: string;
        let userIdB: number;
        let tokenBBefore: string;
        try {
          const [aUserRows] = await conn.query(
            'SELECT userId FROM `user` WHERE email = ?',
            ['user-a@example.com'],
          );
          const userIdA = (aUserRows as UserRow[])[0]!.userId;
          const [aTokenRows] = await conn.query(
            'SELECT token FROM `emailVerificationToken` WHERE userId = ?',
            [userIdA],
          );
          tokenA = (aTokenRows as TokenRow[])[0]!.token;

          const [bUserRows] = await conn.query(
            'SELECT userId FROM `user` WHERE email = ?',
            ['user-b@example.com'],
          );
          userIdB = (bUserRows as UserRow[])[0]!.userId;
          const [bTokenRows] = await conn.query(
            'SELECT token FROM `emailVerificationToken` WHERE userId = ?',
            [userIdB],
          );
          tokenBBefore = (bTokenRows as TokenRow[])[0]!.token;
        } finally {
          await conn.end();
        }

        // Verify user A only.
        const verifyResponse = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { token: tokenA },
        });
        expect(verifyResponse.statusCode).toBe(200);

        // User B is still unverified; B's token row is intact and unchanged.
        const conn2 = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [bUserRows] = await conn2.query(
            'SELECT * FROM `user` WHERE userId = ?',
            [userIdB],
          );
          expect((bUserRows as UserRow[])[0]!.emailVerifiedAt).toBeNull();

          const [bTokenRows] = await conn2.query(
            'SELECT token FROM `emailVerificationToken` WHERE userId = ?',
            [userIdB],
          );
          const tokens = bTokenRows as TokenRow[];
          expect(tokens).toHaveLength(1);
          expect(tokens[0]!.token).toBe(tokenBBefore);
        } finally {
          await conn2.end();
        }
      } finally {
        await app.close();
      }
    });
  });
});
