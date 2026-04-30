import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { workspaceTable } from '../../src/schema/workspace';

describe('workspace schema', () => {
  const config = getTableConfig(workspaceTable);
  const byName = (name: string) => config.columns.find((c) => c.name === name);

  it('declares the expected columns', () => {
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'createdAt',
      'name',
      'updatedAt',
      'workspaceId',
    ]);
  });

  it('workspaceId is the primary key, unsigned int with autoincrement', () => {
    const pk = byName('workspaceId');
    expect(pk).toBeDefined();
    expect(pk?.primary).toBe(true);
    expect(pk?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('name is a non-null varchar(255)', () => {
    const name = byName('name');
    expect(name?.notNull).toBe(true);
    expect(name?.getSQLType().toLowerCase()).toBe('varchar(255)');
  });
});
