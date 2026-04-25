import type { Connection } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { workspaceRoleTable } from '../../src/schema/workspaceRole';

export async function applyWithCollaboratorRole(conn: Connection): Promise<void> {
  const db = drizzle(conn);
  await db.insert(workspaceRoleTable).values({ role: 'Collaborator', sortKey: 20 });
}
