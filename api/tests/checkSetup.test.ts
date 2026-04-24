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

  // ─── Planned checks (roadmap) ──────────────────────────────────────────────
  // Each .todo is promoted to a real test + implementation when the component
  // it validates lands. This list IS the roadmap; if a new check is warranted,
  // add it here first. See the red/green TDD rhythm in recent commit history
  // for the pattern.
  it.todo('includes a config_loaded check (env vars valid at runtime)');
  it.todo('includes a database_reachable check');
  it.todo('includes a migrations_current check');
  it.todo('includes an expected_tables_exist check');
  it.todo('includes a workspace_role_seeded check');
  it.todo('includes an auth_configured check (Better-Auth secret + providers)');
  it.todo('includes an email_sender_configured check (Mailpit in dev, provider in prod)');
  it.todo('returns degraded when a non-critical check fails');
  it.todo('returns failed when a critical check fails');
  it.todo('distinguishes critical vs non-critical checks so degraded vs failed is meaningful');
});
