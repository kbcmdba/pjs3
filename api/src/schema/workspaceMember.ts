import { int, mysqlTable, timestamp, unique } from 'drizzle-orm/mysql-core';
import { userTable } from './user';
import { workspaceTable } from './workspace';
import { workspaceRoleTable } from './workspaceRole';

export const workspaceMemberTable = mysqlTable(
  'workspaceMember',
  {
    workspaceMemberId: int('workspaceMemberId', { unsigned: true })
      .primaryKey()
      .autoincrement(),
    workspaceId: int('workspaceId', { unsigned: true })
      .notNull()
      .references(() => workspaceTable.workspaceId),
    userId: int('userId', { unsigned: true })
      .notNull()
      .references(() => userTable.userId),
    workspaceRoleId: int('workspaceRoleId', { unsigned: true })
      .notNull()
      .references(() => workspaceRoleTable.workspaceRoleId),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    unique('workspaceMember_workspaceId_userId_unique').on(
      table.workspaceId,
      table.userId,
    ),
  ],
);
