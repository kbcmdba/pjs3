import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

export const workspaceRoleTable = mysqlTable('workspaceRole', {
  id: int('id', { unsigned: true }).primaryKey().autoincrement(),
  role: varchar('role', { length: 64 }).notNull().unique(),
  sortKey: int('sortKey', { unsigned: true }).notNull(),
});
