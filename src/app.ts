import { Hono } from 'hono';
import { config } from './config.js';
import { loadFeeds, listFeeds, getFeed, saveFeed, deleteFeed } from './feeds/store.js';
import { executeFeed } from './feeds/executor.js';
import { listSkills, loadSkillsFromDir } from './agent/skills.js';
import { renderRSS } from './views/rss.js';
import { logger } from './utils/logger.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function createApp(): Promise<Hono> {
  const app = new Hono();

  loadFeeds();
  loadSkillsFromDir(new URL('../skills', import.meta.url).pathname);

  // ── Feed serving ──

  app.get('/feed/:id', async (ctx) => {
    const id = ctx.req.param('id');
    const feed = getFeed(id);

    // Try static cache first (written by `openrss refresh`)
    const staticPath = join(config.feedsDir, '..', 'static', `${id}.xml`);
    if (existsSync(staticPath)) {
      const xml = readFileSync(staticPath, 'utf-8');
      ctx.header('Content-Type', 'application/xml; charset=utf-8');
      ctx.header('X-OpenRSS-Cache', 'STATIC');
      return ctx.body(xml);
    }

    if (!feed) {
      return ctx.json({ error: 'Feed not found. Use `openrss register` to create one.' }, 404);
    }

    // Only public feeds can be executed live by the server
    if (feed.strategy !== 'public') {
      return ctx.json({
        error: `Feed "${id}" requires browser session. Run \`openrss refresh ${id}\` to generate static XML.`,
      }, 503);
    }

    try {
      const data = await executeFeed(feed);
      if (data.items && !data.item) data.item = (data as any).items;

      const format = ctx.req.query('format') || 'rss';
      if (format === 'json') {
        return ctx.json({
          version: 'https://jsonfeed.org/version/1.1',
          title: data.title,
          home_page_url: data.link,
          items: (data.item || []).map(item => ({
            id: item.guid || item.link,
            url: item.link,
            title: item.title,
            content_html: item.description,
            date_published: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
            authors: item.author ? [{ name: item.author }] : undefined,
          })),
        });
      }

      const xml = renderRSS(data, ctx.req.url);
      ctx.header('Content-Type', 'application/xml; charset=utf-8');
      return ctx.body(xml);
    } catch (err: any) {
      logger.error(`Feed ${id} error:`, err.message);
      return ctx.json({ error: err.message }, 500);
    }
  });

  // ── API (for programmatic access) ──

  app.get('/api/feeds', (ctx) => ctx.json(listFeeds()));
  app.get('/api/skills', (ctx) => ctx.json(listSkills()));

  // ── Index ──

  app.get('/', (ctx) => {
    const feeds = listFeeds();
    const lines = feeds.length
      ? feeds.map(f => `  /feed/${f.id}  — ${f.name} (${f.strategy})`).join('\n')
      : '  (none — use `openrss register` to create feeds)';

    return ctx.text(
`🗞️  OpenRSS v0.5.0

Registered Feeds:
${lines}

Endpoints:
  GET /feed/:id           RSS XML (or static cache from openrss refresh)
  GET /feed/:id?format=json  JSON Feed
  GET /api/feeds          List feeds (JSON)
  GET /api/skills         List skills (JSON)
`);
  });

  app.get('/healthz', (ctx) => ctx.json({ status: 'ok' }));

  return app;
}
