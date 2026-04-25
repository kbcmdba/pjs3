import type { MySql2Database } from 'drizzle-orm/mysql2';
import { workspaceRoleTable } from '../schema/workspaceRole';

export async function seedReferenceData(db: MySql2Database): Promise<void> {
  await db.insert(workspaceRoleTable).values([
    { role: 'Owner', sortKey: 10 },
    { role: 'Viewer', sortKey: 30 },
  ]);
}
