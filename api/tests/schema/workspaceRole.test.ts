import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { workspaceRoleTable } from '../../src/schema/workspaceRole';

describe('workspaceRole schema', () => {
  const config = getTableConfig(workspaceRoleTable);
  const byName = (name: string) => config.columns.find((c) => c.name === name);

  it('declares exactly workspaceRoleId, role, sortKey columns', () => {
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'role',
      'sortKey',
      'workspaceRoleId',
    ]);
  });

  it('workspaceRoleId is the primary key, unsigned int with autoincrement', () => {
    const pk = byName('workspaceRoleId');
    expect(pk).toBeDefined();
    expect(pk?.primary).toBe(true);
    expect(pk?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('role is a non-null varchar(64) with a unique constraint', () => {
    const role = byName('role');
    expect(role).toBeDefined();
    expect(role?.notNull).toBe(true);
    expect(role?.getSQLType().toLowerCase()).toBe('varchar(64)');
    expect(role?.isUnique).toBe(true);
  });

  it('sortKey is a non-null unsigned int', () => {
    const sortKey = byName('sortKey');
    expect(sortKey).toBeDefined();
    expect(sortKey?.notNull).toBe(true);
    expect(sortKey?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });
});
