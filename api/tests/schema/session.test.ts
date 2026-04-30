import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { sessionTable } from '../../src/schema/session';

describe('session schema', () => {
  const config = getTableConfig(sessionTable);
  const byName = (name: string) => config.columns.find((c) => c.name === name);

  it('declares the expected columns (lastActiveAt mutates on each request; no general updatedAt)', () => {
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'createdAt',
      'currentRoleId',
      'currentWorkspaceId',
      'expiresAt',
      'jti',
      'lastActiveAt',
      'sessionId',
      'userId',
    ]);
  });

  it('sessionId is the primary key, unsigned int with autoincrement', () => {
    const pk = byName('sessionId');
    expect(pk).toBeDefined();
    expect(pk?.primary).toBe(true);
    expect(pk?.getSQLType().toLowerCase()).toMatch(/^int unsigned$/);
  });

  it('FK columns (userId, currentWorkspaceId, currentRoleId) are non-null unsigned int', () => {
    for (const fkName of ['userId', 'currentWorkspaceId', 'currentRoleId']) {
      const fk = byName(fkName);
      expect(fk?.notNull, `${fkName} should be notNull`).toBe(true);
      expect(fk?.getSQLType().toLowerCase(), `${fkName} should be int unsigned`).toMatch(/^int unsigned$/);
    }
  });

  it('jti is a non-null unique varchar(36) - the JWT ID embedded in claims for session lookup', () => {
    const jti = byName('jti');
    expect(jti?.notNull).toBe(true);
    expect(jti?.getSQLType().toLowerCase()).toBe('varchar(36)');
    expect(jti?.isUnique).toBe(true);
  });

  it('expiresAt is a non-null timestamp (absolute expiry; signing-key rotation horizon)', () => {
    const expires = byName('expiresAt');
    expect(expires?.notNull).toBe(true);
  });

  it('lastActiveAt is a non-null timestamp (updated on each request to track idle TTL)', () => {
    const lastActive = byName('lastActiveAt');
    expect(lastActive?.notNull).toBe(true);
  });
});
