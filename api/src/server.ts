import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import pkg from '../package.json';
import { loadConfig } from './config';

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

function overallStatus(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === 'failed')) return 'failed';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'ok';
}

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(opts);

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/checkSetup', async () => {
    const checks = [nodeVersionCheck(), appVersionCheck(), configLoadedCheck()];
    return { status: overallStatus(checks), checks };
  });

  return app;
}
