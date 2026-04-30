import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { userTable } from './user';
import { workspaceTable } from './workspace';
import { workspaceRoleTable } from './workspaceRole';

/**
 * Server-side session record per issued JWT.
 *
 * The JWT acts as a cryptographically-signed handle to a row here:
 *   - signature check on each request (no DB hit) verifies the JWT is ours,
 *   - then the session row lookup (by `jti`) confirms the session is still
 *     valid and updates `lastActiveAt` to drive the idle-TTL behavior.
 *
 * This is why we keep server-side state even though we use JWTs for the
 * payload: pure-stateless JWT cannot do "activity resets the timer" since
 * there is nowhere to record activity.
 */
export const sessionTable = mysqlTable('session', {
  sessionId: int('sessionId', { unsigned: true }).primaryKey().autoincrement(),

  // FK ON DELETE RESTRICT: cannot delete a user whose sessions still exist;
  // log out / delete sessions first. Same rule for workspace and role FKs.
  userId: int('userId', { unsigned: true })
    .notNull()
    .references(() => userTable.userId, { onDelete: 'restrict', onUpdate: 'restrict' }),

  // jti = "JWT ID" (RFC 7519 standard claim). A unique opaque identifier
  // embedded in the JWT's claims. Server uses it to look up the row; without
  // it, the JWT alone could not be invalidated (logout, workspace switch).
  // varchar(36) sized to fit a UUID-shape, which is what most JWT libraries
  // emit by default.
  jti: varchar('jti', { length: 36 }).notNull().unique(),

  currentWorkspaceId: int('currentWorkspaceId', { unsigned: true })
    .notNull()
    .references(() => workspaceTable.workspaceId, { onDelete: 'restrict', onUpdate: 'restrict' }),
  currentRoleId: int('currentRoleId', { unsigned: true })
    .notNull()
    .references(() => workspaceRoleTable.workspaceRoleId, { onDelete: 'restrict', onUpdate: 'restrict' }),

  // Absolute expiry; signing-key rotation horizon. Beyond this the JWT is
  // rejected outright regardless of activity.
  expiresAt: timestamp('expiresAt').notNull(),

  // Updated on each authenticated request. Drives the idle-TTL check:
  // now() - lastActiveAt > user.sessionIdleTtlMinutes -> session is stale.
  lastActiveAt: timestamp('lastActiveAt').notNull().defaultNow(),

  createdAt: timestamp('createdAt').notNull().defaultNow(),
});
