import { Hono } from 'hono';
import { config } from './config.js';
import { cacheMiddleware } from './middleware/cache.js';
import { templateMiddleware } from './middleware/template.js';
import { loadFeeds, listFeeds, getFeed, saveFeed, deleteFeed } from './feeds/store.js';
import { executeFeed } from './feeds/executor.js';
import { findSkill, listSkills, loadSkillsFromDir } from './agent/skills.js';
import { checkExtensionConnected } from './browser/client.js';
import { withBrowserPage } from './browser/session.js';
import { logger } from './utils/logger.js';
import type { FeedDefinition } from './feeds/store.js';

export async function createApp(): Promise<Hono> {
  const app = new Hono();

  loadFeeds();
  loadSkillsFromDir(new URL('../skills', import.meta.url).pathname);

  // ═══════════════════════════════════════════
  //  Tools API — for AI agents to call
  // ═══════════════════════════════════════════

  const tools = new Hono();

  /** Fetch a URL and return cleaned HTML (public pages) */
  tools.post('/fetch', async (ctx) => {
    const { url } = await ctx.req.json<{ url: string }>();
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 OpenRSS/0.1',
        'Accept': 'text/html',
      },
    });
    const html = await resp.text();
    return ctx.json({ ok: true, status: resp.status, html, length: html.length });
  });

  /** Navigate browser to URL and return page HTML (uses Chrome session) */
  tools.post('/navigate', async (ctx) => {
    const { url, waitFor } = await ctx.req.json<{ url: string; waitFor?: string }>();
    const html = await withBrowserPage(new URL(url).hostname, async (page) => {
      await page.goto(url);
      if (waitFor) {
        await page.waitForSelector(waitFor);
      } else {
        await page.evaluate('new Promise(r => setTimeout(r, 3000))');
      }
      return page.evaluate<string>('document.documentElement.outerHTML');
    });
    return ctx.json({ ok: true, html, length: html.length });
  });

  /** Run JavaScript in browser page context */
  tools.post('/evaluate', async (ctx) => {
    const { url, script, waitFor } = await ctx.req.json<{ url: string; script: string; waitFor?: string }>();
    const result = await withBrowserPage(new URL(url).hostname, async (page) => {
      await page.goto(url);
      if (waitFor) {
        await page.waitForSelector(waitFor);
      } else {
        await page.evaluate('new Promise(r => setTimeout(r, 3000))');
      }
      return page.evaluate(script);
    });
    return ctx.json({ ok: true, result });
  });

  /** Get cookies for a domain from the browser */
  tools.post('/cookies', async (ctx) => {
    const { domain } = await ctx.req.json<{ domain: string }>();
    const cookies = await withBrowserPage(domain, async (page) => {
      return page.getCookies(domain);
    });
    return ctx.json({ ok: true, cookies });
  });

  /** Check if Chrome Extension is connected */
  tools.get('/status', async (ctx) => {
    const connected = await checkExtensionConnected();
    return ctx.json({ extension: connected, feeds: listFeeds().length });
  });

  /** Register a new feed definition */
  tools.post('/feeds', async (ctx) => {
    const body = await ctx.req.json<Omit<FeedDefinition, 'createdAt'>>();
    if (!body.id || !body.url || !body.extractionScript) {
      return ctx.json({ error: 'Required: id, url, extractionScript' }, 400);
    }
    const feed: FeedDefinition = { ...body, createdAt: new Date().toISOString() };
    saveFeed(feed);
    return ctx.json({ ok: true, feed, servedAt: `/feed/${feed.id}` });
  });

  /** List all registered feeds */
  tools.get('/feeds', (ctx) => {
    return ctx.json(listFeeds().map(f => ({
      id: f.id, name: f.name, url: f.url, strategy: f.strategy,
      servedAt: `/feed/${f.id}`,
    })));
  });

  /** Delete a feed */
  tools.delete('/feeds/:id', (ctx) => {
    const deleted = deleteFeed(ctx.req.param('id'));
    return ctx.json({ ok: deleted });
  });

  /** List available skills (site-specific hints) */
  tools.get('/skills', (ctx) => {
    return ctx.json(listSkills());
  });

  /** Look up skill for a URL */
  tools.post('/skills/match', async (ctx) => {
    const { url } = await ctx.req.json<{ url: string }>();
    const skill = findSkill(url);
    return ctx.json({ url, skill: skill || null });
  });

  app.route('/tools', tools);

  // ═══════════════════════════════════════════
  //  Feed serving — serves registered feeds as RSS
  // ═══════════════════════════════════════════

  app.get('/feed/:id', async (ctx) => {
    const feed = getFeed(ctx.req.param('id'));
    if (!feed) {
      return ctx.json({ error: 'Feed not found' }, 404);
    }
    try {
      const data = await executeFeed(feed);
      // Normalize: extraction scripts return 'items', our type uses 'item'
      if ((data as any).items && !data.item) {
        data.item = (data as any).items;
      }
      logger.info(`Feed ${feed.id}: ${data.item?.length ?? 0} items`);

      const format = ctx.req.query('format') || 'rss';
      if (format === 'json') {
        return ctx.json({
          version: 'https://jsonfeed.org/version/1.1',
          title: data.title,
          home_page_url: data.link,
          description: data.description,
          items: (data.item || []).map(item => ({
            id: item.guid || item.link,
            url: item.link,
            title: item.title,
            content_html: item.description,
            date_published: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
            authors: item.author ? [{ name: item.author }] : undefined,
            tags: item.category,
          })),
        });
      }

      const { renderRSS } = await import('./views/rss.js');
      const xml = renderRSS(data, ctx.req.url);
      ctx.header('Content-Type', 'application/xml; charset=utf-8');
      return ctx.body(xml);
    } catch (err: any) {
      logger.error(`Feed ${feed.id} execution error:`, err.message);
      return ctx.json({ error: err.message }, 500);
    }
  });

  // ═══════════════════════════════════════════
  //  Index
  // ═══════════════════════════════════════════

  app.get('/', (ctx) => {
    const feeds = listFeeds();
    const feedLines = feeds.length
      ? feeds.map(f => `  ${f.strategy === 'browser' ? '🔐' : '🌐'} /feed/${f.id}  — ${f.name}`).join('\n')
      : '  (none yet — use an AI agent to create feeds)';

    return ctx.text(
`🗞️  OpenRSS v0.3.0 — Universal RSS via AI Agents

Provide tools for AI agents to turn any website into an RSS feed.

═══ Registered Feeds ═══
${feedLines}

═══ Tools API (for agents) ═══
  POST /tools/fetch       — Fetch a URL, return HTML
  POST /tools/navigate    — Navigate browser to URL (with login session)
  POST /tools/evaluate    — Run JS in browser page context
  POST /tools/cookies     — Get browser cookies for a domain
  GET  /tools/status      — Check extension connection
  POST /tools/feeds       — Register a new feed definition
  GET  /tools/feeds       — List all feeds
  DELETE /tools/feeds/:id — Remove a feed
  GET  /tools/skills      — List built-in site skills
  POST /tools/skills/match — Find skill for a URL

═══ Feed Output ═══
  GET /feed/:id           — Serve feed as RSS XML
  GET /feed/:id?format=json — Serve feed as JSON Feed

See AGENT.md for how AI agents should use these tools.
`);
  });

  app.get('/healthz', (ctx) => ctx.json({ status: 'ok' }));

  return app;
}
