import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server';
import { parseDatabaseUrl } from '../../src/db';
import { withTestDb } from '../helpers/testDb';

// HS256 requires >= 32 bytes of key material; this is 49 chars and meets that.
const TEST_JWT_SIGNING_KEY = 'test-signing-key-must-be-at-least-32-bytes-long';

// 8-4-4-4-12 hex digits, hyphen-separated. UUIDs from `crypto.randomUUID()`
// match this exactly. The schema column is CHAR(36).
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserRow {
  userId: number;
  email: string;
  emailVerifiedAt: Date | null;
}

interface SessionRow {
  sessionId: number;
  userId: number;
  jti: string;
  currentWorkspaceId: number;
  currentRoleId: number;
  expiresAt: Date;
  lastActiveAt: Date;
}

interface WorkspaceMemberRow {
  workspaceMemberId: number;
  workspaceId: number;
  userId: number;
  workspaceRoleId: number;
}

/**
 * Sign up + consume the verification token. Mirrors the production flow so the
 * `user` row ends up in the same state a real verified user would be in.
 */
async function signupAndVerify(
  app: FastifyInstance,
  databaseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password },
  });

  const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
  let token: string;
  try {
    const [tokenRows] = await conn.query(
      'SELECT t.token FROM `emailVerificationToken` t ' +
        'JOIN `user` u ON u.userId = t.userId WHERE u.email = ?',
      [email],
    );
    token = (tokenRows as Array<{ token: string }>)[0]!.token;
  } finally {
    await conn.end();
  }

  await app.inject({
    method: 'POST',
    url: '/auth/verify-email',
    payload: { token },
  });
}

/**
 * Per ADR 0003 §"Login: workspace selection on multi-membership" + §"Email
 * verification: hard gate":
 *
 * - Endpoint: POST /auth/login
 * - Body: { email, password }
 * - Success (verified user, correct password):
 *     - 200 { jwt: '<signed-token>' }
 *     - JWT signed with the configured JWT_SIGNING_KEY (HS256).
 *     - JWT carries: userId, currentWorkspaceId, currentRoleId, jti, iat, exp.
 *     - exp = iat + sessionIdleTtlMinutes * 60 (default 240 min = 4h).
 *     - First-time login also creates the user's personal workspace +
 *       workspaceMember(role=Owner) atomically.
 *     - A `session` row is inserted with the JWT's jti as the handle.
 * - Failure (any reason — wrong password, no such user, unverified email,
 *   missing field, malformed input):
 *     - 400 { error: 'invalid credentials' }
 *     - Identical response shape across all failure modes (account-enumeration
 *       defense per the ADR).
 *     - No session row, no workspace, no workspaceMember created.
 *
 * This PR does NOT cover: HttpOnly/SameSite cookies (frontend wires those up
 * later), multi-workspace selection (single-workspace MVP), rate limiting
 * (separate concern), workspace-switch endpoint.
 */
describe('POST /auth/login - integration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('issues a JWT, creates a workspace + Owner member, and persists a session row on first verified login', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        await signupAndVerify(
          app,
          databaseUrl,
          'first-login@example.com',
          'a-strong-password',
        );

        const response = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'first-login@example.com', password: 'a-strong-password' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(typeof body.jwt).toBe('string');
        expect(body.jwt.length).toBeGreaterThan(20);

        // The JWT must verify with the same signing key the server was given.
        const secretKey = new TextEncoder().encode(TEST_JWT_SIGNING_KEY);
        const { payload } = await jwtVerify(body.jwt, secretKey);

        // Custom claims.
        expect(typeof payload.userId).toBe('number');
        expect(typeof payload.currentWorkspaceId).toBe('number');
        expect(typeof payload.currentRoleId).toBe('number');

        // RFC 7519 standard claims.
        expect(typeof payload.jti).toBe('string');
        expect(payload.jti).toMatch(UUID_REGEX);
        expect(typeof payload.iat).toBe('number');
        expect(typeof payload.exp).toBe('number');

        // exp is roughly now + sessionIdleTtlMinutes (default 240 min = 14400s).
        // 60-second tolerance is the same pattern signup tests use for token
        // expiry (and would have caught the PR #34 timezone-offset class of bug).
        const expectedExp = Math.floor(Date.now() / 1000) + 240 * 60;
        expect(Math.abs((payload.exp as number) - expectedExp)).toBeLessThan(60);

        // DB state: workspace + Owner member + session row.
        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [userRows] = await conn.query(
            'SELECT userId FROM `user` WHERE email = ?',
            ['first-login@example.com'],
          );
          const userId = (userRows as UserRow[])[0]!.userId;
          expect(payload.userId).toBe(userId);

          // Membership is created with Owner role.
          const [memberRows] = await conn.query(
            'SELECT m.*, r.role FROM `workspaceMember` m ' +
              'JOIN `workspaceRole` r ON r.workspaceRoleId = m.workspaceRoleId ' +
              'WHERE m.userId = ?',
            [userId],
          );
          const members = memberRows as Array<WorkspaceMemberRow & { role: string }>;
          expect(members).toHaveLength(1);
          expect(members[0]!.role).toBe('Owner');
          expect(members[0]!.workspaceId).toBe(payload.currentWorkspaceId);
          expect(members[0]!.workspaceRoleId).toBe(payload.currentRoleId);

          // Workspace row exists.
          const [workspaceRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `workspace` WHERE workspaceId = ?',
            [payload.currentWorkspaceId],
          );
          expect((workspaceRows as Array<{ cnt: number }>)[0]!.cnt).toBe(1);

          // Session row matches the JWT's jti and carries the same context.
          const [sessionRows] = await conn.query(
            'SELECT * FROM `session` WHERE jti = ?',
            [payload.jti],
          );
          const sessions = sessionRows as SessionRow[];
          expect(sessions).toHaveLength(1);
          expect(sessions[0]!.userId).toBe(userId);
          expect(sessions[0]!.currentWorkspaceId).toBe(payload.currentWorkspaceId);
          expect(sessions[0]!.currentRoleId).toBe(payload.currentRoleId);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('reuses the existing workspace and creates a new session row on subsequent logins', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        await signupAndVerify(
          app,
          databaseUrl,
          'repeat@example.com',
          'a-strong-password',
        );

        const first = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'repeat@example.com', password: 'a-strong-password' },
        });
        expect(first.statusCode).toBe(200);

        const second = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'repeat@example.com', password: 'a-strong-password' },
        });
        expect(second.statusCode).toBe(200);

        // Each login issues a distinct JWT (different jti).
        const secretKey = new TextEncoder().encode(TEST_JWT_SIGNING_KEY);
        const firstPayload = (await jwtVerify(first.json().jwt, secretKey)).payload;
        const secondPayload = (await jwtVerify(second.json().jwt, secretKey)).payload;
        expect(firstPayload.jti).not.toBe(secondPayload.jti);
        // But the same workspace is bound to both.
        expect(firstPayload.currentWorkspaceId).toBe(secondPayload.currentWorkspaceId);

        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          // Still exactly one membership — no duplicate workspace creation.
          const [memberRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `workspaceMember` m ' +
              'JOIN `user` u ON u.userId = m.userId WHERE u.email = ?',
            ['repeat@example.com'],
          );
          expect((memberRows as Array<{ cnt: number }>)[0]!.cnt).toBe(1);

          // Two sessions now — one per login.
          const [sessionRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `session` s ' +
              'JOIN `user` u ON u.userId = s.userId WHERE u.email = ?',
            ['repeat@example.com'],
          );
          expect((sessionRows as Array<{ cnt: number }>)[0]!.cnt).toBe(2);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('rejects a wrong password with the indistinguishable failure shape and creates no session', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        await signupAndVerify(
          app,
          databaseUrl,
          'wrong-pw@example.com',
          'right-password',
        );

        const response = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'wrong-pw@example.com', password: 'WRONG-password' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid credentials' });

        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [sessionRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `session`',
          );
          expect((sessionRows as Array<{ cnt: number }>)[0]!.cnt).toBe(0);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('rejects a no-such-user login with the indistinguishable failure shape and creates no session', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'nobody@example.com', password: 'whatever-password' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid credentials' });

        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [sessionRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `session`',
          );
          expect((sessionRows as Array<{ cnt: number }>)[0]!.cnt).toBe(0);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  it('rejects an unverified-email login with the same shape (verification is a hard gate)', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        // Signup but do NOT verify — the user row exists but emailVerifiedAt is null.
        await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: { email: 'unverified@example.com', password: 'a-strong-password' },
        });

        const response = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'unverified@example.com', password: 'a-strong-password' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid credentials' });

        // Hard gate property: no workspace, no membership, no session, and the
        // user is *still* unverified (we did not silently flip the bit).
        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [userRows] = await conn.query(
            'SELECT * FROM `user` WHERE email = ?',
            ['unverified@example.com'],
          );
          expect((userRows as UserRow[])[0]!.emailVerifiedAt).toBeNull();

          const [sessionRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `session`',
          );
          expect((sessionRows as Array<{ cnt: number }>)[0]!.cnt).toBe(0);

          const [workspaceRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `workspace`',
          );
          expect((workspaceRows as Array<{ cnt: number }>)[0]!.cnt).toBe(0);

          const [memberRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `workspaceMember`',
          );
          expect((memberRows as Array<{ cnt: number }>)[0]!.cnt).toBe(0);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });

  /**
   * The default sessionIdleTtlMinutes is 240 (= 4h). A user who has shortened
   * their setting must see the JWT's `exp` honor that — otherwise the green
   * code is hardcoding 4h and silently ignoring the documented user-facing
   * setting from ADR 0003.
   *
   * No settings endpoint exists yet, so we mutate the column directly. When the
   * settings endpoint lands, this test stays valid as-is (DB-direct mutation
   * is a stronger check than going through the endpoint anyway).
   */
  it('honors the user\'s sessionIdleTtlMinutes when computing the JWT exp claim', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        await signupAndVerify(
          app,
          databaseUrl,
          'short-ttl@example.com',
          'a-strong-password',
        );

        // Shorten this user's idle TTL to 15 minutes — well clear of the 240
        // default so any "I'm hardcoding the default" green code is caught.
        const SHORT_TTL_MINUTES = 15;
        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          await conn.query(
            'UPDATE `user` SET sessionIdleTtlMinutes = ? WHERE email = ?',
            [SHORT_TTL_MINUTES, 'short-ttl@example.com'],
          );
        } finally {
          await conn.end();
        }

        const response = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'short-ttl@example.com', password: 'a-strong-password' },
        });
        expect(response.statusCode).toBe(200);

        const secretKey = new TextEncoder().encode(TEST_JWT_SIGNING_KEY);
        const { payload } = await jwtVerify(response.json().jwt, secretKey);
        const expectedExp = Math.floor(Date.now() / 1000) + SHORT_TTL_MINUTES * 60;
        // Same 60s tolerance as the happy-path test.
        expect(Math.abs((payload.exp as number) - expectedExp)).toBeLessThan(60);
      } finally {
        await app.close();
      }
    });
  });

  it('rejects missing fields with the same shape and creates no session', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'missing-pw@example.com' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid credentials' });

        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [sessionRows] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `session`',
          );
          expect((sessionRows as Array<{ cnt: number }>)[0]!.cnt).toBe(0);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });
});
