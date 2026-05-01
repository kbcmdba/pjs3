import argon2 from 'argon2';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { parseDatabaseUrl } from '../db';
import { userTable } from '../schema/user';
import { workspaceTable } from '../schema/workspace';
import { workspaceMemberTable } from '../schema/workspaceMember';
import { workspaceRoleTable } from '../schema/workspaceRole';
import { sessionTable } from '../schema/session';
import { signJwt } from './jwt';

const OWNER_ROLE = 'Owner';

/**
 * Precomputed argon2id hash, used in the "no such user" timing-defense path.
 * Without this, the no-such-user branch would skip the ~100ms argon2.verify
 * call and respond noticeably faster than the wrong-password branch — that
 * timing differential is exactly what an attacker uses to enumerate accounts.
 *
 * Same parameters as production hashes (default argon2id) so the verify-time
 * profile matches.
 */
const DUMMY_HASH_PROMISE = argon2.hash('placeholder-for-timing-safety', {
  type: argon2.argon2id,
});

export interface LoginResult {
  jwt: string;
}

/**
 * Format-only validation of the login request body.
 *
 * No length floors or pattern checks — failed credentials are caught at the
 * verify step and collapse to the same indistinguishable response anyway.
 * Only here to prove the body is shaped `{ email: string, password: string }`
 * before we touch the DB.
 */
export function validateLoginInput(
  body: unknown,
): { ok: true; email: string; password: string } | { ok: false } {
  if (!body || typeof body !== 'object') return { ok: false };
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') return { ok: false };
  if (email.length === 0 || password.length === 0) return { ok: false };
  return { ok: true, email, password };
}

/**
 * Authenticate, ensure-or-create the user's personal workspace, issue a JWT,
 * and persist a server-side session row.
 *
 * Returns null on any failure (no such user, wrong password, unverified
 * email). The HTTP layer translates `null` into a single 400 'invalid
 * credentials' response shared across all auth-fail paths — indistinguishable
 * failure modes per ADR 0003.
 *
 * Workspace bootstrap on first verified login is wrapped in a transaction
 * with a SELECT ... FOR UPDATE on the user row, so two concurrent first-
 * logins by the same user cannot each create their own workspace. The lock
 * forces the second login to wait until the first commits, after which it
 * sees the membership and reuses the workspace.
 */
export async function performLogin(
  databaseUrl: string,
  email: string,
  password: string,
  signingKey: string,
): Promise<LoginResult | null> {
  const conn = await mysql.createConnection(parseDatabaseUrl(databaseUrl));
  try {
    const db = drizzle(conn);

    const userRows = await db
      .select({
        userId: userTable.userId,
        passwordHash: userTable.passwordHash,
        emailVerifiedAt: userTable.emailVerifiedAt,
        sessionIdleTtlMinutes: userTable.sessionIdleTtlMinutes,
      })
      .from(userTable)
      .where(eq(userTable.email, email));

    let passwordOk = false;
    if (userRows.length === 0) {
      // Verify against the dummy. Result is always false; the value is the
      // wall-clock cost — same shape as a real verify against a real hash.
      await argon2.verify(await DUMMY_HASH_PROMISE, password);
    } else {
      passwordOk = await argon2.verify(userRows[0]!.passwordHash, password);
    }

    if (userRows.length === 0 || !passwordOk) return null;
    const user = userRows[0]!;
    if (user.emailVerifiedAt === null) return null;

    let currentWorkspaceId = 0;
    let currentRoleId = 0;

    await db.transaction(async (tx) => {
      // Lock the user row for the duration of this transaction. Prevents two
      // concurrent first-logins from each creating a personal workspace.
      await tx
        .select({ userId: userTable.userId })
        .from(userTable)
        .where(eq(userTable.userId, user.userId))
        .for('update');

      const memberRows = await tx
        .select({
          workspaceId: workspaceMemberTable.workspaceId,
          workspaceRoleId: workspaceMemberTable.workspaceRoleId,
        })
        .from(workspaceMemberTable)
        .where(eq(workspaceMemberTable.userId, user.userId));

      if (memberRows.length > 0) {
        currentWorkspaceId = memberRows[0]!.workspaceId;
        currentRoleId = memberRows[0]!.workspaceRoleId;
        return;
      }

      const ownerRoleRows = await tx
        .select({ workspaceRoleId: workspaceRoleTable.workspaceRoleId })
        .from(workspaceRoleTable)
        .where(eq(workspaceRoleTable.role, OWNER_ROLE));
      if (ownerRoleRows.length === 0) {
        throw new Error(`workspaceRole '${OWNER_ROLE}' not seeded`);
      }
      const ownerRoleId = ownerRoleRows[0]!.workspaceRoleId;

      // Default workspace name is the email's local-part. Users can rename
      // later when the settings UI lands.
      const workspaceName = email.split('@')[0] || 'Personal';
      const [workspaceInsert] = await tx
        .insert(workspaceTable)
        .values({ name: workspaceName });
      const workspaceId = workspaceInsert.insertId;

      await tx.insert(workspaceMemberTable).values({
        workspaceId,
        userId: user.userId,
        workspaceRoleId: ownerRoleId,
      });

      currentWorkspaceId = workspaceId;
      currentRoleId = ownerRoleId;
    });

    const expiresInSeconds = user.sessionIdleTtlMinutes * 60;
    const issued = await signJwt(
      { userId: user.userId, currentWorkspaceId, currentRoleId },
      signingKey,
      expiresInSeconds,
    );

    await db.insert(sessionTable).values({
      userId: user.userId,
      jti: issued.jti,
      currentWorkspaceId,
      currentRoleId,
      expiresAt: new Date(issued.exp * 1000),
    });

    return { jwt: issued.jwt };
  } finally {
    await conn.end();
  }
}
