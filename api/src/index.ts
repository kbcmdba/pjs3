import { buildApp } from './server';
import { loadConfig } from './config';

const config = loadConfig();

if (config.errors.length > 0) {
  console.warn('Config warnings (defaults applied where applicable — see /checkSetup):');
  for (const err of config.errors) {
    console.warn(`  - ${err}`);
  }
}

const app = await buildApp({ logger: true });

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error({ err }, 'Failed to start PJS3 API');
  process.exit(1);
}
