import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const userTable = mysqlTable('user', {
  userId: int('userId', { unsigned: true }).primaryKey().autoincrement(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('passwordHash', { length: 255 }).notNull(),
  emailVerifiedAt: timestamp('emailVerifiedAt'),
  sessionIdleTtlMinutes: int('sessionIdleTtlMinutes', { unsigned: true })
    .notNull()
    .default(240),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow().onUpdateNow(),
});
