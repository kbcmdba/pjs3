import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import pkg from '../package.json';

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

  it('includes an app_version check with the package.json name and version', async () => {
    const response = await app.inject({ method: 'GET', url: '/checkSetup' });
    const body = response.json() as Report;

    const versionCheck = body.checks.find((c) => c.name === 'app_version');
    expect(versionCheck).toBeDefined();
    expect(versionCheck?.status).toBe('ok');
    expect(versionCheck?.message).toContain(pkg.name);
    expect(versionCheck?.message).toContain(pkg.version);
  });
});

describe('GET /checkSetup — config_loaded', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.stubEnv('PORT', '8443');
    vi.stubEnv('HOST', '0.0.0.0');
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('reports ok when PORT and HOST are valid', async () => {
    const response = await app.inject({ method: 'GET', url: '/checkSetup' });
    const body = response.json() as Report;

    const configCheck = body.checks.find((c) => c.name === 'config_loaded');
    expect(configCheck).toBeDefined();
    expect(configCheck?.status).toBe('ok');
  });

  it('reports failed when PORT is not a valid integer', async () => {
    vi.stubEnv('PORT', 'not-a-number');

    const response = await app.inject({ method: 'GET', url: '/checkSetup' });
    const body = response.json() as Report;

    const configCheck = body.checks.find((c) => c.name === 'config_loaded');
    expect(configCheck?.status).toBe('failed');
    expect(configCheck?.message).toContain('PORT');
  });

  it('reports failed when PORT is out of range', async () => {
    vi.stubEnv('PORT', '99999');

    const response = await app.inject({ method: 'GET', url: '/checkSetup' });
    const body = response.json() as Report;

    const configCheck = body.checks.find((c) => c.name === 'config_loaded');
    expect(configCheck?.status).toBe('failed');
    expect(configCheck?.message).toContain('PORT');
  });

  it('reports failed when HOST is empty', async () => {
    vi.stubEnv('HOST', '');

    const response = await app.inject({ method: 'GET', url: '/checkSetup' });
    const body = response.json() as Report;

    const configCheck = body.checks.find((c) => c.name === 'config_loaded');
    expect(configCheck?.status).toBe('failed');
    expect(configCheck?.message).toContain('HOST');
  });
});
