import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { workspaceMemberTable } from '../../src/schema/workspaceMember';

describe('workspaceMember schema', () => {
  const config = getTableConfig(workspaceMemberTable);
  const byName = (name: string) => config.columns.find((c) => c.name === name);

  it('declares the expected columns (no updatedAt; junction is append-only)', () => {
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'createdAt',
      'userId',
      'workspaceId',
      'workspaceMemberId',
      'workspaceRoleId',
    ]);
  });

  it('workspaceMemberId is the primary key, unsigned int with autoincrement', () => {
    const pk = byName('workspaceMemberId');
    expect(pk).toBeDefined();
    expect(pk?.primary).toBe(true);
    expect(pk?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('FK columns (workspaceId, userId, workspaceRoleId) are non-null unsigned int', () => {
    for (const fkName of ['workspaceId', 'userId', 'workspaceRoleId']) {
      const fk = byName(fkName);
      expect(fk?.notNull, `${fkName} should be notNull`).toBe(true);
      expect(fk?.getSQLType().toLowerCase(), `${fkName} should be int unsigned`).toMatch(/^int unsigned$/);
    }
  });

  it('declares a UNIQUE KEY on (workspaceId, userId) so each user has at most one membership per workspace', () => {
    const uniques = config.uniqueConstraints ?? [];
    const hasComposite = uniques.some(
      (u) =>
        u.columns.length === 2 &&
        u.columns.some((c) => c.name === 'workspaceId') &&
        u.columns.some((c) => c.name === 'userId'),
    );
    expect(hasComposite).toBe(true);
  });
});
