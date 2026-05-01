import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { parseDatabaseUrl } from '../db';
import { userTable } from '../schema/user';
import { emailVerificationTokenTable } from '../schema/emailVerificationToken';

// Tokens are produced as `randomBytes(32).toString('hex')` — strictly lowercase.
// Strict regex matches the canonical form. Uppercase hex is rejected.
const TOKEN_REGEX = /^[0-9a-f]{64}$/;

/** Format-only validation. Does not touch the DB. */
export function validateVerifyEmailInput(
  body: unknown,
): { ok: true; token: string } | { ok: false } {
  if (!body || typeof body !== 'object') return { ok: false };
  const { token } = body as { token?: unknown };
  if (typeof token !== 'string') return { ok: false };
  if (!TOKEN_REGEX.test(token)) return { ok: false };
  return { ok: true, token };
}

/**
 * Consume an email-verification token.
 *
 * On success: marks `user.emailVerifiedAt = NOW()` and deletes the token row,
 * atomically (single transaction).
 *
 * On failure (no such token / expired / any other reason): returns `{ ok: false }`
 * with no DB side-effects. Per ADR 0003, all failure modes are indistinguishable
 * to the caller.
 */
export async function verifyEmail(
  databaseUrl: string,
  token: string,
): Promise<{ ok: boolean }> {
  const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
  try {
    const db = drizzle(conn);

    const rows = await db
      .select({
        tokenId: emailVerificationTokenTable.emailVerificationTokenId,
        userId: emailVerificationTokenTable.userId,
        expiresAt: emailVerificationTokenTable.expiresAt,
      })
      .from(emailVerificationTokenTable)
      .where(eq(emailVerificationTokenTable.token, token));

    if (rows.length === 0) return { ok: false };
    const row = rows[0]!;
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false };

    await db.transaction(async (tx) => {
      await tx
        .update(userTable)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(userTable.userId, row.userId));
      await tx
        .delete(emailVerificationTokenTable)
        .where(eq(emailVerificationTokenTable.emailVerificationTokenId, row.tokenId));
    });

    return { ok: true };
  } finally {
    await conn.end();
  }
}
