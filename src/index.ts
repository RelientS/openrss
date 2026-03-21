import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { startDaemon } from './browser/daemon.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

async function main() {
  // Start the browser bridge daemon
  await startDaemon();

  // Create and start the HTTP server
  const app = await createApp();

  serve({
    fetch: app.fetch,
    port: config.port,
  }, () => {
    logger.info(`
  ╔═══════════════════════════════════════════╗
  ║           🗞️  OpenRSS v0.1.0              ║
  ║                                           ║
  ║  Server:  http://localhost:${String(config.port).padEnd(5)}          ║
  ║  Daemon:  ws://127.0.0.1:${String(config.daemonPort).padEnd(5)}        ║
  ║                                           ║
  ║  Load the Chrome Extension from           ║
  ║  extension/ to enable browser routes      ║
  ╚═══════════════════════════════════════════╝
`);
  });
}

main().catch((err) => {
  logger.error('Failed to start:', err);
  process.exit(1);
});
