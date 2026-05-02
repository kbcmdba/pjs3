import { randomUUID } from 'node:crypto';
import { SignJWT, type JWTPayload } from 'jose';

export interface JwtCustomClaims {
  userId: number;
  currentWorkspaceId: number;
  currentRoleId: number;
}

export interface IssuedJwt {
  /** The compact-serialized signed JWT, ready to send to the client. */
  jwt: string;
  /** The session handle (RFC 7519 `jti` claim). Persisted on the `session` row. */
  jti: string;
  /** Issued-at, Unix seconds. */
  iat: number;
  /** Expires-at, Unix seconds. */
  exp: number;
}

/**
 * Sign a JWT with HS256.
 *
 * HS256 requires >= 32 bytes of key material. Caller is responsible for
 * passing a sufficiently long signing key (validated upstream when the env
 * is read).
 *
 * Custom claims (userId, currentWorkspaceId, currentRoleId) are first-class
 * payload entries; jti/iat/exp are RFC 7519 standard claims set via the
 * SignJWT setters so any conformant JWT library or debug tool recognizes
 * them.
 */
export async function signJwt(
  claims: JwtCustomClaims,
  signingKey: string,
  expiresInSeconds: number,
): Promise<IssuedJwt> {
  const secret = new TextEncoder().encode(signingKey);
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;

  const jwt = await new SignJWT(claims as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret);

  return { jwt, jti, iat, exp };
}

export interface VerifiedJwt {
  userId: number;
  currentWorkspaceId: number;
  currentRoleId: number;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Verify a JWT signed with the given key and return its claims.
 *
 * Returns `{ ok: true, claims }` when the signature is valid, the token
 * is unexpired, and all required claims are present. Returns `{ ok: false }`
 * for any failure mode — bad signature, expired, malformed, missing
 * required claims. The HTTP route is responsible for translating
 * `{ ok: false }` into a 401 response; the failure mode is intentionally
 * collapsed (account-enumeration / replay-defense).
 */
export async function verifyJwt(
  _token: string,
  _signingKey: string,
): Promise<{ ok: true; claims: VerifiedJwt } | { ok: false }> {
  throw new Error('verifyJwt: not implemented (TDD red step)');
}
