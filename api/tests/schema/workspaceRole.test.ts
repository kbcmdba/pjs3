import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { workspaceRoleTable } from '../../src/schema/workspaceRole';

describe('workspaceRole schema', () => {
  const config = getTableConfig(workspaceRoleTable);
  const byName = (name: string) => config.columns.find((c) => c.name === name);

  it('declares exactly id, value, sortKey columns', () => {
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'id',
      'sortKey',
      'value',
    ]);
  });

  it('id is the primary key, unsigned int with autoincrement', () => {
    const id = byName('id');
    expect(id).toBeDefined();
    expect(id?.primary).toBe(true);
    expect(id?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('value is a non-null varchar(64) with a unique constraint', () => {
    const value = byName('value');
    expect(value).toBeDefined();
    expect(value?.notNull).toBe(true);
    expect(value?.getSQLType().toLowerCase()).toBe('varchar(64)');

    const hasUnique = config.uniqueConstraints?.some((u) =>
      u.columns.some((c) => c.name === 'value'),
    );
    expect(hasUnique).toBe(true);
  });

  it('sortKey is a non-null unsigned int', () => {
    const sortKey = byName('sortKey');
    expect(sortKey).toBeDefined();
    expect(sortKey?.notNull).toBe(true);
    expect(sortKey?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });
});
