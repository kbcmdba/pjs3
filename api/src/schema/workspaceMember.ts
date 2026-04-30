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
    // FK ON DELETE RESTRICT: a workspace cannot be deleted while members reference it;
    // membership rows must be removed first. This forces explicit teardown rather than
    // silent orphaning. Same rule for user and workspaceRole.
    workspaceId: int('workspaceId', { unsigned: true })
      .notNull()
      .references(() => workspaceTable.workspaceId, { onDelete: 'restrict', onUpdate: 'restrict' }),
    userId: int('userId', { unsigned: true })
      .notNull()
      .references(() => userTable.userId, { onDelete: 'restrict', onUpdate: 'restrict' }),
    workspaceRoleId: int('workspaceRoleId', { unsigned: true })
      .notNull()
      .references(() => workspaceRoleTable.workspaceRoleId, { onDelete: 'restrict', onUpdate: 'restrict' }),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    unique('workspaceMember_workspaceId_userId_unique').on(
      table.workspaceId,
      table.userId,
    ),
  ],
);
