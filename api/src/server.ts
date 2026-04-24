import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

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

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(opts);

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/checkSetup', async () => {
    const check = nodeVersionCheck();
    return { status: check.status, checks: [check] };
  });

  return app;
}
