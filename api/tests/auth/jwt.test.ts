import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { signJwt, verifyJwt } from '../../src/auth/jwt';

const KEY = 'test-signing-key-must-be-at-least-32-bytes-long';
const WRONG_KEY = 'a-completely-different-32-byte-key!!';

const SAMPLE_CLAIMS = {
  userId: 42,
  currentWorkspaceId: 7,
  currentRoleId: 1,
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure-function unit tests for `signJwt` and `verifyJwt`. No DB, no app.
 *
 * Coverage invariant: the integration test for /auth/logout uses a happy-
 * path JWT only. Every JWT-rejection mode (wrong signature, expired,
 * garbage, missing claims) needs to be caught here.
 */
describe('signJwt', () => {
  it('produces a JWT that verifies with the same key and returns ALL claims intact', async () => {
    const issued = await signJwt(SAMPLE_CLAIMS, KEY, 3600);
    const result = await verifyJwt(issued.jwt, KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Custom claims survive the roundtrip.
    expect(result.claims.userId).toBe(SAMPLE_CLAIMS.userId);
    expect(result.claims.currentWorkspaceId).toBe(SAMPLE_CLAIMS.currentWorkspaceId);
    expect(result.claims.currentRoleId).toBe(SAMPLE_CLAIMS.currentRoleId);
    // Standard claims also survive — verifyJwt must expose jti/iat/exp,
    // not strip them. Caller (logout, future middleware) needs them.
    expect(result.claims.jti).toBe(issued.jti);
    expect(result.claims.iat).toBe(issued.iat);
    expect(result.claims.exp).toBe(issued.exp);
  });

  it('returns a UUID-shaped jti', async () => {
    const issued = await signJwt(SAMPLE_CLAIMS, KEY, 3600);
    expect(issued.jti).toMatch(UUID_REGEX);
  });

  it('returns iat and exp consistent with the requested TTL', async () => {
    const issued = await signJwt(SAMPLE_CLAIMS, KEY, 600);
    expect(issued.exp - issued.iat).toBe(600);
  });

  it('returns iat near the current time (within 60s tolerance)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const issued = await signJwt(SAMPLE_CLAIMS, KEY, 600);
    const after = Math.floor(Date.now() / 1000);
    expect(issued.iat).toBeGreaterThanOrEqual(before - 1);
    expect(issued.iat).toBeLessThanOrEqual(after + 1);
  });

  it('issues distinct jtis on each call', async () => {
    const a = await signJwt(SAMPLE_CLAIMS, KEY, 3600);
    const b = await signJwt(SAMPLE_CLAIMS, KEY, 3600);
    expect(a.jti).not.toBe(b.jti);
  });
});

describe('verifyJwt', () => {
  it('returns ok=false for a JWT signed with a different key', async () => {
    const issued = await signJwt(SAMPLE_CLAIMS, WRONG_KEY, 3600);
    const result = await verifyJwt(issued.jwt, KEY);
    expect(result.ok).toBe(false);
  });

  it('returns ok=false for a JWT whose exp is in the past', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const secret = new TextEncoder().encode(KEY);
    const expiredJwt = await new SignJWT({ ...SAMPLE_CLAIMS })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('00000000-0000-0000-0000-000000000000')
      .setIssuedAt(nowSec - 7200)
      .setExpirationTime(nowSec - 3600)
      .sign(secret);
    const result = await verifyJwt(expiredJwt, KEY);
    expect(result.ok).toBe(false);
  });

  it('returns ok=false for a non-JWT garbage string', async () => {
    const result = await verifyJwt('not.a.jwt', KEY);
    expect(result.ok).toBe(false);
  });

  it('returns ok=false for an empty token', async () => {
    const result = await verifyJwt('', KEY);
    expect(result.ok).toBe(false);
  });

  it('returns ok=false for a JWT missing userId', async () => {
    const secret = new TextEncoder().encode(KEY);
    const jwt = await new SignJWT({
      currentWorkspaceId: 7,
      currentRoleId: 1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('00000000-0000-0000-0000-000000000000')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const result = await verifyJwt(jwt, KEY);
    expect(result.ok).toBe(false);
  });

  it('returns ok=false for a JWT missing currentWorkspaceId', async () => {
    const secret = new TextEncoder().encode(KEY);
    const jwt = await new SignJWT({
      userId: 42,
      currentRoleId: 1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('00000000-0000-0000-0000-000000000000')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const result = await verifyJwt(jwt, KEY);
    expect(result.ok).toBe(false);
  });

  it('returns ok=false for a JWT missing currentRoleId', async () => {
    const secret = new TextEncoder().encode(KEY);
    const jwt = await new SignJWT({
      userId: 42,
      currentWorkspaceId: 7,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('00000000-0000-0000-0000-000000000000')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const result = await verifyJwt(jwt, KEY);
    expect(result.ok).toBe(false);
  });

  /**
   * Tampering: mint a real JWT with the right key, then replace the
   * payload section with a different-but-well-formed base64url. The
   * signature was computed over the original payload, so verification
   * must fail.
   */
  it('returns ok=false for a JWT whose payload was modified after signing', async () => {
    const issued = await signJwt(SAMPLE_CLAIMS, KEY, 3600);
    const [header, , signature] = issued.jwt.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ userId: 999, currentWorkspaceId: 999, currentRoleId: 999 }),
      'utf-8',
    ).toString('base64url');
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    const result = await verifyJwt(tampered, KEY);
    expect(result.ok).toBe(false);
  });

  /**
   * The canonical JWT vulnerability: a token whose header declares
   * `alg: none` and has no signature. A library that doesn't pin the
   * expected algorithm will accept it. Ours must not.
   */
  it('returns ok=false for an alg:none JWT (canonical JWT vuln)', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
      'utf-8',
    ).toString('base64url');
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        ...SAMPLE_CLAIMS,
        jti: '00000000-0000-0000-0000-000000000000',
        iat: nowSec,
        exp: nowSec + 3600,
      }),
      'utf-8',
    ).toString('base64url');
    const algNoneJwt = `${header}.${payload}.`;
    const result = await verifyJwt(algNoneJwt, KEY);
    expect(result.ok).toBe(false);
  });
});
