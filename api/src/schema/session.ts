import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { userTable } from './user';
import { workspaceTable } from './workspace';
import { workspaceRoleTable } from './workspaceRole';

export const sessionTable = mysqlTable('session', {
  sessionId: int('sessionId', { unsigned: true }).primaryKey().autoincrement(),
  userId: int('userId', { unsigned: true })
    .notNull()
    .references(() => userTable.userId),
  jti: varchar('jti', { length: 36 }).notNull().unique(),
  currentWorkspaceId: int('currentWorkspaceId', { unsigned: true })
    .notNull()
    .references(() => workspaceTable.workspaceId),
  currentRoleId: int('currentRoleId', { unsigned: true })
    .notNull()
    .references(() => workspaceRoleTable.workspaceRoleId),
  expiresAt: timestamp('expiresAt').notNull(),
  lastActiveAt: timestamp('lastActiveAt').notNull().defaultNow(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});
