import { char, int, mysqlTable, timestamp } from 'drizzle-orm/mysql-core';
import { userTable } from './user';

export const emailVerificationTokenTable = mysqlTable('emailVerificationToken', {
  emailVerificationTokenId: int('emailVerificationTokenId', { unsigned: true })
    .primaryKey()
    .autoincrement(),
  // FK ON DELETE RESTRICT: deleting a user must first delete their unconsumed
  // verification tokens (or wait for the 24h cleanup task). Forces explicit
  // teardown rather than silently orphaning verification tokens.
  userId: int('userId', { unsigned: true })
    .notNull()
    .references(() => userTable.userId, { onDelete: 'restrict', onUpdate: 'restrict' }),
  // Hex-encoded 32 bytes of cryptographic random = 64 chars exactly.
  // CHAR(64) over VARCHAR(64): no length-prefix overhead, no waste on the
  // index since VARCHAR is treated as fixed-width in BTREE anyway.
  token: char('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});
