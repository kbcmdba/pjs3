import { buildApp } from './server';

const DEFAULT_PORT = 8443;
const DEFAULT_HOST = '0.0.0.0';

const rawPort = process.env.PORT ?? String(DEFAULT_PORT);
const port = Number(rawPort);
const host = process.env.HOST ?? DEFAULT_HOST;

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid PORT: "${rawPort}" — must be an integer between 1 and 65535.`);
  process.exit(1);
}

const app = await buildApp({ logger: true });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error({ err }, 'Failed to start PJS3 API');
  process.exit(1);
}
