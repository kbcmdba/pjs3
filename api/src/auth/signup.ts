import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { parseDatabaseUrl } from '../db';
import { userTable } from '../schema/user';
import { emailVerificationTokenTable } from '../schema/emailVerificationToken';

const PASSWORD_MIN_LENGTH = 8;
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h per ADR 0003.
const TOKEN_BYTES = 32; // 256 bits, hex-encoded -> 64-char fixed-width matches the schema.

// Format-only validation. Deliverability is verified via the verification email itself.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupResult {
  /** Always `true`. The shape is identical whether the email is new or already
   *  registered (account-enumeration defense). */
  success: true;
}

export type SignupValidationError = 'missingField' | 'invalidEmail' | 'passwordTooShort';

/** Format-only validation of the request body. Does not touch the database. */
export function validateSignupInput(
  body: unknown,
): { ok: true; email: string; password: string } | { ok: false; error: SignupValidationError } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'missingField' };
  }
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') {
    return { ok: false, error: 'missingField' };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: 'invalidEmail' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: 'passwordTooShort' };
  }
  return { ok: true, email, password };
}

/**
 * Perform a signup against the database.
 *
 * - If the email is new: hashes the password (argon2id), inserts an unverified
 *   `user` row, generates a 32-byte hex `emailVerificationToken` row with a 24h
 *   expiry. Returns `{ success: true }`.
 * - If the email is already registered: silently no-ops on the database and
 *   returns the same `{ success: true }`. We still hash the password
 *   unconditionally so the response timing does not differ between the two
 *   cases (account-enumeration defense).
 *
 * Email sending is intentionally not part of this function; the token row is
 * created here, the deliverability layer (Mailpit in dev, real provider in
 * prod) is wired up in a subsequent PR.
 */
export async function performSignup(
  databaseUrl: string,
  email: string,
  password: string,
): Promise<SignupResult> {
  // Hash unconditionally — dominant time cost; doing it for every request
  // (including duplicate-email paths) keeps the response timing constant
  // and prevents account enumeration via timing attacks.
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
  try {
    const db = drizzle(conn);

    const existing = await db
      .select({ userId: userTable.userId })
      .from(userTable)
      .where(eq(userTable.email, email));

    if (existing.length > 0) {
      // Email already registered — silently no-op. Same response shape.
      return { success: true };
    }

    const [insertResult] = await db.insert(userTable).values({ email, passwordHash });
    const userId = insertResult.insertId;

    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);
    await db.insert(emailVerificationTokenTable).values({ userId, token, expiresAt });

    return { success: true };
  } finally {
    await conn.end();
  }
}
