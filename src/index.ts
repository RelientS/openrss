import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

async function main() {
  const app = await createApp();

  serve({ fetch: app.fetch, port: config.port }, () => {
    logger.info(`OpenRSS server listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  logger.error('Failed to start:', err);
  process.exit(1);
});
