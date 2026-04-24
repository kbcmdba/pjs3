import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';

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

describe('GET /checkSetup', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with { status, checks[] } structure', async () => {
    const response = await app.inject({ method: 'GET', url: '/checkSetup' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Report;
    expect(body.status).toMatch(/^(ok|degraded|failed)$/);
    expect(Array.isArray(body.checks)).toBe(true);
  });

  it('includes a node_version check reporting the runtime version', async () => {
    const response = await app.inject({ method: 'GET', url: '/checkSetup' });
    const body = response.json() as Report;

    const nodeCheck = body.checks.find((c) => c.name === 'node_version');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck?.status).toBe('ok');
    expect(nodeCheck?.message).toContain(process.version);
  });

});
