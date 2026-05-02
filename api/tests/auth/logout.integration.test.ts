import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server';
import { parseDatabaseUrl } from '../../src/db';
import { withTestDb } from '../helpers/testDb';

const TEST_JWT_SIGNING_KEY = 'test-signing-key-must-be-at-least-32-bytes-long';

interface JwtClaims {
  userId: number;
  currentWorkspaceId: number;
  currentRoleId: number;
  jti: string;
  iat: number;
  exp: number;
}

async function signupVerifyAndLogin(
  app: FastifyInstance,
  databaseUrl: string,
  email: string,
  password: string,
): Promise<{ jwt: string; jti: string }> {
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

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  const { jwt } = loginResponse.json();
  const [, payloadB64] = jwt.split('.');
  const claims = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf-8'),
  ) as JwtClaims;
  return { jwt, jti: claims.jti };
}

/**
 * Single happy-path integration test for POST /auth/logout.
 *
 * Verifies the route wires the parts together correctly:
 *   header -> parseAuthHeader -> verifyJwt -> performLogout(jti) -> 200.
 *
 * Per the test-granularity principle:
 * - All header-parsing variants are tested in `parseAuthHeader.test.ts`.
 * - All JWT-rejection modes (wrong key, expired, malformed) are tested
 *   in `jwt.test.ts` against `verifyJwt`.
 * - All DELETE-predicate edge cases (cross-session, cross-user, ghost
 *   jti) are tested in `performLogout.test.ts`.
 *
 * The integration test's only job is wiring. Anything that could fail
 * here without one of the unit tests also failing means the unit
 * coverage is too sparse, not that this test is doing useful diagnosis.
 */
describe('POST /auth/logout - integration (wiring)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wires header parsing, JWT verification, and session deletion end-to-end', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('JWT_SIGNING_KEY', TEST_JWT_SIGNING_KEY);
      const app = await buildApp();
      try {
        const { jwt, jti } = await signupVerifyAndLogin(
          app,
          databaseUrl,
          'happy-path@example.com',
          'a-strong-password',
        );

        // Precondition: confirm the session row exists before logout. Without
        // this, a regression where login issues a JWT but doesn't create the
        // session row would silently pass (count=0 before AND after).
        const preConn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [[preRow]] = await preConn.query(
            'SELECT COUNT(*) AS cnt FROM `session` WHERE jti = ?',
            [jti],
          ) as unknown as [Array<{ cnt: number }>, unknown];
          expect(preRow!.cnt).toBe(1);
        } finally {
          await preConn.end();
        }

        const response = await app.inject({
          method: 'POST',
          url: '/auth/logout',
          headers: { authorization: `Bearer ${jwt}` },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true });

        // The session row that the JWT pointed to is gone.
        const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
        try {
          const [[row]] = await conn.query(
            'SELECT COUNT(*) AS cnt FROM `session` WHERE jti = ?',
            [jti],
          ) as unknown as [Array<{ cnt: number }>, unknown];
          expect(row!.cnt).toBe(0);
        } finally {
          await conn.end();
        }
      } finally {
        await app.close();
      }
    });
  });
});
