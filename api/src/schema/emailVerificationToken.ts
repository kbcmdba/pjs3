import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
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
  token: varchar('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});
