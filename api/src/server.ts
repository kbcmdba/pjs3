import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import pkg from '../package.json';
import { loadConfig } from './config';
import { pingDatabase } from './db';
import { checkMigrationsCurrent } from './migrations';
import { performSignup, validateSignupInput } from './auth/signup';
import { validateVerifyEmailInput, verifyEmail } from './auth/verifyEmail';

type CheckStatus = 'ok' | 'degraded' | 'failed';
interface Check {
  name: string;
  status: CheckStatus;
  message: string;
}

const MIN_NODE_MAJOR = 22;

function nodeVersionCheck(): Check {
  const major = Number(process.version.slice(1).split('.')[0]);
  const status: CheckStatus = major >= MIN_NODE_MAJOR ? 'ok' : 'failed';
  return {
    name: 'node_version',
    status,
    message: `Runtime ${process.version} (required: >=v${MIN_NODE_MAJOR})`,
  };
}

function appVersionCheck(): Check {
  return {
    name: 'app_version',
    status: 'ok',
    message: `${pkg.name} v${pkg.version}`,
  };
}

function configLoadedCheck(): Check {
  const config = loadConfig();
  if (config.errors.length === 0) {
    return {
      name: 'config_loaded',
      status: 'ok',
      message: `PORT=${config.port}, HOST=${config.host}`,
    };
  }
  return {
    name: 'config_loaded',
    status: 'failed',
    message: config.errors.join(' '),
  };
}

async function databaseReachableCheck(): Promise<Check> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      name: 'database_reachable',
      status: 'failed',
      message: 'DATABASE_URL is not set',
    };
  }
  const result = await pingDatabase(databaseUrl);
  return {
    name: 'database_reachable',
    status: result.ok ? 'ok' : 'failed',
    message: result.message,
  };
}

async function migrationsCurrentCheck(): Promise<Check> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      name: 'migrations_current',
      status: 'failed',
      message: 'DATABASE_URL is not set',
    };
  }
  const result = await checkMigrationsCurrent(databaseUrl);
  return {
    name: 'migrations_current',
    status: result.current ? 'ok' : 'failed',
    message: result.message,
  };
}

function overallStatus(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === 'failed')) return 'failed';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(opts);

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/checkSetup', async () => {
    const checks = [
      nodeVersionCheck(),
      appVersionCheck(),
      configLoadedCheck(),
      await databaseReachableCheck(),
      await migrationsCurrentCheck(),
    ];
    return { status: overallStatus(checks), checks };
  });

  app.post('/auth/signup', async (request, reply) => {
    const validation = validateSignupInput(request.body);
    if (!validation.ok) {
      return reply.status(400).send({ error: 'invalid input' });
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return reply.status(500).send({ error: 'DATABASE_URL is not set' });
    }
    const result = await performSignup(databaseUrl, validation.email, validation.password);
    return reply.status(201).send(result);
  });

  app.post('/auth/verify-email', async (request, reply) => {
    const validation = validateVerifyEmailInput(request.body);
    if (!validation.ok) {
      return reply.status(400).send({ error: 'invalid token' });
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return reply.status(500).send({ error: 'DATABASE_URL is not set' });
    }
    const result = await verifyEmail(databaseUrl, validation.token);
    if (!result.ok) {
      return reply.status(400).send({ error: 'invalid token' });
    }
    return reply.status(200).send({ success: true });
  });

  return app;
}
