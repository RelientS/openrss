import { Hono } from 'hono';
import { cacheMiddleware } from './middleware/cache.js';
import { templateMiddleware } from './middleware/template.js';
import { loadRoutes, mountRoutes, getNamespaces } from './registry.js';

// ── Import route modules ──

import { namespace as twitterNs } from './routes/twitter/namespace.js';
import { route as twitterUser } from './routes/twitter/user.js';

import { namespace as githubNs } from './routes/github/namespace.js';
import { route as githubTrending } from './routes/github/trending.js';

import { namespace as bilibiliNs } from './routes/bilibili/namespace.js';
import { route as bilibiliUser } from './routes/bilibili/user.js';

// ── Create app ──

export async function createApp(): Promise<Hono> {
  const app = new Hono();

  // Register routes
  await loadRoutes([
    { nsKey: 'twitter', namespace: twitterNs, routes: [twitterUser] },
    { nsKey: 'github', namespace: githubNs, routes: [githubTrending] },
    { nsKey: 'bilibili', namespace: bilibiliNs, routes: [bilibiliUser] },
  ]);

  // Middleware pipeline: cache check → route handler → template render
  app.use('/*', cacheMiddleware);
  app.use('/*', templateMiddleware);

  // Mount all routes
  mountRoutes(app);

  // ── Index page ──

  app.get('/', (ctx) => {
    const namespaces = getNamespaces();
    const routes: string[] = [];
    for (const [key, ns] of namespaces) {
      for (const route of ns.routes) {
        routes.push(`  ${route.strategy === 'public' ? '🌐' : '🔐'} ${route.example}  — ${route.name} (${ns.namespace.name})`);
      }
    }
    return ctx.text(
      `🗞️  OpenRSS v0.1.0\n\n` +
      `Turn any website into an RSS feed.\n` +
      `Zero config — reuses your browser login sessions.\n\n` +
      `Available routes:\n${routes.join('\n')}\n\n` +
      `🌐 = public (no browser needed)  🔐 = needs browser session\n\n` +
      `Add ?format=json for JSON Feed output.\n`
    );
  });

  // ── Health check ──

  app.get('/healthz', (ctx) => ctx.json({ status: 'ok' }));

  return app;
}
