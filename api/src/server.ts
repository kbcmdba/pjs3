import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(opts);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
