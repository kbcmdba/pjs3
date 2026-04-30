import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const workspaceTable = mysqlTable('workspace', {
  workspaceId: int('workspaceId', { unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow().onUpdateNow(),
});
