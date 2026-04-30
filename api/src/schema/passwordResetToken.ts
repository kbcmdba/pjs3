import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { userTable } from './user';

export const passwordResetTokenTable = mysqlTable('passwordResetToken', {
  passwordResetTokenId: int('passwordResetTokenId', { unsigned: true })
    .primaryKey()
    .autoincrement(),
  userId: int('userId', { unsigned: true })
    .notNull()
    .references(() => userTable.userId),
  token: varchar('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});
