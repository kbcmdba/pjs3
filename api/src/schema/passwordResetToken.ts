import { char, int, mysqlTable, timestamp } from 'drizzle-orm/mysql-core';
import { userTable } from './user';

export const passwordResetTokenTable = mysqlTable('passwordResetToken', {
  passwordResetTokenId: int('passwordResetTokenId', { unsigned: true })
    .primaryKey()
    .autoincrement(),
  // FK ON DELETE RESTRICT: deleting a user must first delete their unconsumed
  // reset tokens. Forces explicit teardown rather than silent orphaning.
  userId: int('userId', { unsigned: true })
    .notNull()
    .references(() => userTable.userId, { onDelete: 'restrict', onUpdate: 'restrict' }),
  // Hex-encoded 32 bytes of cryptographic random = 64 chars exactly.
  // CHAR(64) over VARCHAR(64) for the same reason as emailVerificationToken.
  token: char('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});
