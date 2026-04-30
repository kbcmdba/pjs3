import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { emailVerificationTokenTable } from '../../src/schema/emailVerificationToken';

describe('emailVerificationToken schema', () => {
  const config = getTableConfig(emailVerificationTokenTable);
  const byName = (name: string) => config.columns.find((c) => c.name === name);

  it('declares the expected columns (no updatedAt; tokens are single-use, deleted on consume)', () => {
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'createdAt',
      'emailVerificationTokenId',
      'expiresAt',
      'token',
      'userId',
    ]);
  });

  it('emailVerificationTokenId is the primary key, unsigned int with autoincrement', () => {
    const pk = byName('emailVerificationTokenId');
    expect(pk).toBeDefined();
    expect(pk?.primary).toBe(true);
    expect(pk?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('userId is non-null unsigned int (FK to user)', () => {
    const userId = byName('userId');
    expect(userId?.notNull).toBe(true);
    expect(userId?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('token is a non-null unique char(64) - hex-encoded 32 bytes of cryptographic random', () => {
    const token = byName('token');
    expect(token?.notNull).toBe(true);
    expect(token?.getSQLType().toLowerCase()).toBe('char(64)');
    expect(token?.isUnique).toBe(true);
  });

  it('expiresAt is a non-null timestamp (24h after creation per ADR 0003)', () => {
    const expires = byName('expiresAt');
    expect(expires?.notNull).toBe(true);
  });
});
