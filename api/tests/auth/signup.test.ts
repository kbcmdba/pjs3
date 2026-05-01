import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { buildApp } from '../../src/server';
import { parseDatabaseUrl } from '../../src/db';
import { withTestDb } from '../helpers/testDb';

interface UserRow {
  userId: number;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
}

interface TokenRow {
  emailVerificationTokenId: number;
  userId: number;
  token: string;
  expiresAt: Date;
}

describe('POST /auth/signup - integration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a user row and an emailVerificationToken row on a successful signup', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'newuser@example.com', password: 'a-strong-password' },
        });

        expect(response.statusCode).toBe(201);
        expect(response.json()).toEqual({ success: true });

        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [userRows] = await conn.query(
            'SELECT * FROM `user` WHERE email = ?',
            ['newuser@example.com'],
          );
          const users = userRows as UserRow[];
          expect(users).toHaveLength(1);
          expect(users[0]!.emailVerifiedAt).toBeNull();
          // Password is hashed, not stored plaintext.
          expect(users[0]!.passwordHash).not.toBe('a-strong-password');
          expect(users[0]!.passwordHash.length).toBeGreaterThan(20);

          const [tokenRows] = await conn.query(
            'SELECT * FROM `emailVerificationToken` WHERE userId = ?',
            [users[0]!.userId],
          );
          const tokens = tokenRows as TokenRow[];
          expect(tokens).toHaveLength(1);
          // 32 bytes hex-encoded -> exactly 64 chars per the schema.
          expect(tokens[0]!.token).toHaveLength(64);
          expect(tokens[0]!.token).toMatch(/^[0-9a-f]{64}$/);
          // Token expires roughly 24h from now (within a 1-minute tolerance).
          const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000;
          const actualExpiry = new Date(tokens[0]!.expiresAt).getTime();
          expect(Math.abs(actualExpiry - expectedExpiry)).toBeLessThan(60 * 1000);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('rejects an invalid email format with 400', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'not-an-email', password: 'a-strong-password' },
        });
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  it('rejects a password shorter than 8 chars with 400 (NIST 800-63 length floor)', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'u@example.com', password: 'short' },
        });
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  it('rejects missing fields with 400', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'u@example.com' },
        });
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  it('returns 201 with the same shape when the email already exists (account-enumeration defense; no second user row, no second token row)', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      const app = await buildApp();
      try {
        const firstResponse = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'existing@example.com', password: 'a-strong-password' },
        });
        expect(firstResponse.statusCode).toBe(201);

        const secondResponse = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'existing@example.com', password: 'a-different-password' },
        });
        // Same status code and response shape — must not leak that the email
        // is already registered.
        expect(secondResponse.statusCode).toBe(201);
        expect(secondResponse.json()).toEqual({ success: true });

        // Verify only one user row, only one token row in the DB.
        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [userRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `user` WHERE email = ?',
            ['existing@example.com'],
          );
          expect((userRows as Array<{ cnt: number }>)[0]!.cnt).toBe(1);

          const [tokenRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `emailVerificationToken`',
          );
          expect((tokenRows as Array<{ cnt: number }>)[0]!.cnt).toBe(1);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });
});
