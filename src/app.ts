import { Hono } from 'hono';
import { config } from './config.js';
import { cacheMiddleware } from './middleware/cache.js';
import { templateMiddleware } from './middleware/template.js';
import { extractFeed } from './agent/extractor.js';
import { findSkill, listSkills, loadSkillsFromDir } from './agent/skills.js';
import { checkExtensionConnected } from './browser/client.js';
import { withBrowserPage } from './browser/session.js';
import { logger } from './utils/logger.js';
import type { Data } from './types.js';

export async function createApp(): Promise<Hono> {
  const app = new Hono();

  // Load custom skills from skills/ directory
  loadSkillsFromDir(new URL('../skills', import.meta.url).pathname);

  // ── Universal Feed Endpoint ──
  //
  //   GET /feed?url=https://example.com/news
  //
  // The AI agent analyzes the page and generates an RSS feed automatically.

  app.get('/feed', cacheMiddleware, templateMiddleware, async (ctx) => {
    const url = ctx.req.query('url');
    if (!url) {
      return ctx.json({ error: 'Missing ?url= parameter. Usage: /feed?url=https://example.com' }, 400);
    }

    // Find matching skill for this URL
    const skill = findSkill(url);
    const needsBrowser = skill?.needsBrowser ?? false;

    let html: string;

    if (needsBrowser) {
      // Use browser bridge to get the page (with login session)
      const connected = await checkExtensionConnected();
      if (!connected) {
        return ctx.json({
          error: 'This site needs your browser login session, but the Chrome Extension is not connected.',
          hint: 'Load the extension/ directory in Chrome → chrome://extensions/',
        }, 503);
      }

      html = await withBrowserPage(new URL(url).hostname, async (page) => {
        await page.goto(url);
        // Wait for dynamic content
        await page.evaluate('new Promise(r => setTimeout(r, 3000))');
        return page.evaluate<string>('document.documentElement.outerHTML');
      });
    } else {
      // Direct fetch for public pages
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 OpenRSS/0.1',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!resp.ok) {
        return ctx.json({ error: `Failed to fetch ${url}: ${resp.status}` }, 502);
      }
      html = await resp.text();
    }

    // AI agent extracts feed items
    const data: Data = await extractFeed(url, html, skill?.prompt);
    ctx.set('data', data);
  });

  // ── Index ──

  app.get('/', (ctx) => {
    const skills = listSkills();
    const lines = skills.map(s =>
      `  ${s.needsBrowser ? '🔐' : '🌐'} ${s.domains.join(', ')}`
    );

    return ctx.text(
`🗞️  OpenRSS v0.2.0 — AI-Powered Universal RSS Generator

Give it any URL, get an RSS feed back.

Usage:
  GET /feed?url=https://example.com/news
  GET /feed?url=https://x.com/elonmusk&format=json

How it works:
  1. OpenRSS fetches the page (or uses your Chrome session for login-required sites)
  2. An AI agent analyzes the page structure
  3. Extracts all content items (articles, posts, videos, etc.)
  4. Returns a standard RSS/JSON feed

Sites with built-in skills (optimized extraction):
${lines.join('\n')}

🌐 = public (direct fetch)  🔐 = needs Chrome Extension for login

Config:
  LLM_BASE_URL = ${config.llm.baseUrl}
  LLM_MODEL    = ${config.llm.model}
  LLM_API_KEY  = ${config.llm.apiKey ? '***set***' : '⚠️  NOT SET — set LLM_API_KEY env var'}
`);
  });

  app.get('/healthz', (ctx) => ctx.json({ status: 'ok' }));

  app.get('/skills', (ctx) => ctx.json(listSkills()));

  return app;
}
