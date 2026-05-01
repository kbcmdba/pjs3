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
