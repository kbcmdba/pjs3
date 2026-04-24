import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(opts);
  return app;
}
