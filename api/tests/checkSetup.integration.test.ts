import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server';
import { withTestDb } from './helpers/testDb';

type CheckStatus = 'ok' | 'degraded' | 'failed';
interface Check {
  name: string;
  status: CheckStatus;
  message: string;
}
interface Report {
  status: CheckStatus;
  checks: Check[];
}

describe('GET /checkSetup database_reachable - integration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports ok when DATABASE_URL points at a freshly migrated + seeded test DB', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);

      const app = await buildApp();
      try {
        const response = await app.inject({ method: 'GET', url: '/checkSetup' });
        expect(response.statusCode).toBe(200);

        const body = response.json() as Report;
        const dbCheck = body.checks.find((c) => c.name === 'database_reachable');
        expect(dbCheck).toBeDefined();
        expect(dbCheck?.status).toBe('ok');
      } finally {
        await app.close();
      }
    });
  });
});

describe('GET /checkSetup migrations_current - integration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports ok when the test DB has all journal migrations applied', async () => {
    await withTestDb(async (databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);

      const app = await buildApp();
      try {
        const response = await app.inject({ method: 'GET', url: '/checkSetup' });
        const body = response.json() as Report;
        const check = body.checks.find((c) => c.name === 'migrations_current');
        expect(check).toBeDefined();
        expect(check?.status).toBe('ok');
      } finally {
        await app.close();
      }
    });
  });
});
