import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
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
  token: varchar('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});
