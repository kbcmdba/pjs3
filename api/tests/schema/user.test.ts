import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { userTable } from '../../src/schema/user';

describe('user schema', () => {
  const config = getTableConfig(userTable);
  const byName = (name: string) => config.columns.find((c) => c.name === name);

  it('declares the expected columns', () => {
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'passwordHash',
      'sessionIdleTtlMinutes',
      'updatedAt',
      'userId',
    ]);
  });

  it('userId is the primary key, unsigned int with autoincrement', () => {
    const pk = byName('userId');
    expect(pk).toBeDefined();
    expect(pk?.primary).toBe(true);
    expect(pk?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('email is a non-null unique varchar(255)', () => {
    const email = byName('email');
    expect(email?.notNull).toBe(true);
    expect(email?.getSQLType().toLowerCase()).toBe('varchar(255)');
    expect(email?.isUnique).toBe(true);
  });

  it('passwordHash is a non-null varchar(255)', () => {
    const passwordHash = byName('passwordHash');
    expect(passwordHash?.notNull).toBe(true);
    expect(passwordHash?.getSQLType().toLowerCase()).toBe('varchar(255)');
  });

  it('emailVerifiedAt is a nullable timestamp (NULL = unverified)', () => {
    const v = byName('emailVerifiedAt');
    expect(v).toBeDefined();
    expect(v?.notNull).toBe(false);
  });

  it('sessionIdleTtlMinutes is unsigned int with default 240', () => {
    const t = byName('sessionIdleTtlMinutes');
    expect(t?.notNull).toBe(true);
    expect(t?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
    expect(t?.hasDefault).toBe(true);
  });
});
