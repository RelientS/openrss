#!/usr/bin/env node

/**
 * OpenRSS CLI — tools for AI agents to turn any website into an RSS feed.
 *
 * Browser commands (eval, discover) use CDP to connect directly to Chrome.
 * No extension needed — just have Chrome running.
 */

import { config } from './config.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'list':
    case 'ls':           return cmdList();
    case 'skills':       return cmdSkills();
    case 'skill-match':  return cmdSkillMatch(args[1]);
    case 'fetch':        return cmdFetch(args[1]);
    case 'evaluate':
    case 'eval':         return cmdEvaluate();
    case 'discover':     return cmdDiscover(args[1]);
    case 'register':
    case 'add':          return cmdRegister();
    case 'remove':
    case 'rm':           return cmdRemove(args[1]);
    case 'refresh':      return cmdRefresh(args[1]);
    case 'serve':
    case 'start':        return cmdServe();
    case 'status':       return cmdStatus();
    default:             printUsage();
  }
}

function printUsage() {
  console.log(`🗞️  OpenRSS — Turn any website into an RSS feed

Discovery & Analysis:
  openrss fetch <url>               Fetch URL (public, no login)
  openrss eval <url> -s "script"    Run JS in Chrome page context (via CDP)
  openrss discover <url>            List all API requests on a page, identify data endpoints

Feed Management:
  openrss register '{json}'         Register a feed definition
  openrss list                      List all registered feeds
  openrss remove <id>               Remove a feed
  openrss refresh <id>              Refresh a feed and cache the result

Skills & Status:
  openrss skills                    List built-in site extraction knowledge
  openrss skill-match <url>         Find skill hints for a URL
  openrss status                    Check Chrome CDP connection and feed count

Server:
  openrss serve                     Start RSS server (port ${config.port})

Browser Strategy:
  eval/discover connect directly to Chrome via CDP (DevToolsActivePort).
  No extension needed. Just have Chrome running.
  In Claude Code, these fall back to Chrome DevTools MCP tools.

Output: JSON to stdout, logs to stderr. Set OPENRSS_FORMAT=pretty for indented output.
`);
}

const pretty = process.env.OPENRSS_FORMAT === 'pretty';
function out(data: unknown) {
  console.log(JSON.stringify(data, null, pretty ? 2 : 0));
}

// ── CDP helper: get a connected page ──

async function getCDPPage(targetUrl?: string) {
  const { connectChromeCDP } = await import('./browser/cdp.js');
  return connectChromeCDP(targetUrl);
}

// ── Commands ──

async function cmdList() {
  const { loadFeeds, listFeeds } = await import('./feeds/store.js');
  loadFeeds();
  out(listFeeds().map(f => ({
    id: f.id, name: f.name, url: f.url, strategy: f.strategy,
    feedUrl: `http://localhost:${config.port}/feed/${f.id}`,
  })));
}

async function cmdSkills() {
  const { listSkills } = await import('./agent/skills.js');
  out(listSkills().map(s => ({
    match: s.match, needsBrowser: s.needsBrowser, description: s.description,
    selectors: s.selectors, apiPatterns: s.apiPatterns, hasExample: !!s.example,
  })));
}

async function cmdSkillMatch(url?: string) {
  if (!url) { console.error('Usage: openrss skill-match <url>'); process.exit(1); }
  const { findSkill } = await import('./agent/skills.js');
  out(findSkill(url) || { match: null, message: 'No skill found for this URL' });
}

async function cmdFetch(url?: string) {
  if (!url) { console.error('Usage: openrss fetch <url>'); process.exit(1); }
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 OpenRSS/0.1',
      'Accept': 'text/html',
    },
  });
  const html = await resp.text();
  out({ ok: true, status: resp.status, length: html.length, html });
}

async function cmdEvaluate() {
  const url = args[1];
  const scriptIdx = args.indexOf('-s') !== -1 ? args.indexOf('-s') : args.indexOf('--script');
  const script = scriptIdx !== -1 ? args[scriptIdx + 1] : undefined;
  const waitIdx = args.indexOf('--wait-for');
  const waitFor = waitIdx !== -1 ? args[waitIdx + 1] : undefined;
  const noNav = args.includes('--no-navigate');

  if (!script) {
    console.error('Usage: openrss eval <url> -s "script" [--wait-for "sel"] [--no-navigate]');
    process.exit(1);
  }

  const page = await getCDPPage(url);
  try {
    if (url && !noNav) {
      await page.goto(url);
      if (waitFor) {
        await page.waitForSelector(waitFor);
      } else {
        await page.evaluate('new Promise(r => setTimeout(r, 3000))');
      }
    }
    const result = await page.evaluate(script);
    out({ ok: true, result });
  } finally {
    await page.close();
  }
}

/**
 * API Discovery — navigate to a page, capture all XHR/Fetch requests,
 * identify which ones are likely data APIs (return JSON with list structures).
 */
async function cmdDiscover(url?: string) {
  if (!url) { console.error('Usage: openrss discover <url>'); process.exit(1); }

  const page = await getCDPPage(url);
  try {
    // Enable network capture before navigating
    await page.enableNetworkCapture();
    await page.goto(url);
    // Wait for page to load and fire API requests
    await page.evaluate('new Promise(r => setTimeout(r, 5000))');
    // Scroll to trigger lazy-loaded content
    await page.evaluate('window.scrollBy(0, document.body.scrollHeight / 2)');
    await page.evaluate('new Promise(r => setTimeout(r, 2000))');

    const requests = await page.getNetworkCapture();

    // Score each request: higher = more likely to be a data API
    const scored = requests.map(r => {
      let score = 0;
      if (r.isArray) score += 3;
      if (r.hasData) score += 2;
      if ((r as any).itemCount && (r as any).itemCount > 2) score += 3;
      if (r.method === 'POST') score += 1;
      if (r.url.includes('/api/') || r.url.includes('/v1/') || r.url.includes('/v2/')) score += 2;
      if (r.url.includes('feed') || r.url.includes('list') || r.url.includes('topic')) score += 2;
      // Penalize non-data endpoints
      if (r.url.includes('analytics') || r.url.includes('tracking') || r.url.includes('log')) score -= 3;
      if (r.url.includes('.js') || r.url.includes('.css')) score -= 5;
      return { ...r, score };
    });

    scored.sort((a, b) => b.score - a.score);

    out({
      url,
      totalRequests: requests.length,
      apis: scored.filter(r => r.score > 0).map(r => ({
        url: r.url,
        method: r.method,
        score: r.score,
        itemCount: (r as any).itemCount,
        hint: r.score >= 5 ? '⭐ likely data API' : r.score >= 3 ? '🔍 possible data API' : 'low confidence',
      })),
    });
  } finally {
    await page.close();
  }
}

async function cmdRegister() {
  const jsonStr = args[1];
  if (!jsonStr) {
    console.error('Usage: openrss register \'{"id":"...","url":"...","extractionScript":"..."}\'');
    process.exit(1);
  }
  const feed = JSON.parse(jsonStr);
  if (!feed.id || !feed.url || !feed.extractionScript) {
    console.error('Required fields: id, url, extractionScript');
    process.exit(1);
  }
  feed.strategy = feed.strategy || 'public';
  feed.name = feed.name || feed.id;
  feed.createdAt = new Date().toISOString();

  const { saveFeed } = await import('./feeds/store.js');
  saveFeed(feed);
  out({
    ok: true,
    feed: { id: feed.id, name: feed.name, url: feed.url, strategy: feed.strategy },
    feedUrl: `http://localhost:${config.port}/feed/${feed.id}`,
  });
}

async function cmdRemove(id?: string) {
  if (!id) { console.error('Usage: openrss remove <id>'); process.exit(1); }
  const { loadFeeds, deleteFeed } = await import('./feeds/store.js');
  loadFeeds();
  out({ ok: deleteFeed(id), id });
}

/**
 * Refresh a feed: execute its extraction script, write cached XML to static/.
 * For browser feeds, connects to Chrome via CDP.
 */
async function cmdRefresh(id?: string) {
  if (!id) { console.error('Usage: openrss refresh <id>'); process.exit(1); }

  const { loadFeeds, getFeed } = await import('./feeds/store.js');
  const { renderRSS } = await import('./views/rss.js');
  const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  loadFeeds();
  const feed = getFeed(id);
  if (!feed) { out({ ok: false, error: 'Feed not found' }); return; }

  let data;
  if (feed.strategy === 'browser') {
    const page = await getCDPPage(feed.url);
    try {
      await page.goto(feed.url);
      if (feed.waitFor) {
        await page.waitForSelector(feed.waitFor);
      } else {
        await page.evaluate('new Promise(r => setTimeout(r, 3000))');
      }
      data = await page.evaluate(feed.extractionScript);
    } finally {
      await page.close();
    }
  } else {
    const resp = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 OpenRSS/0.1', 'Accept': 'text/html' },
    });
    const html = await resp.text();
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('html', feed.extractionScript);
    data = await fn(html);
  }

  // Normalize items key
  if (data.items && !data.item) data.item = data.items;

  // Write cached XML
  const staticDir = join(config.feedsDir, '..', 'static');
  if (!existsSync(staticDir)) mkdirSync(staticDir, { recursive: true });
  const xml = renderRSS(data);
  const xmlPath = join(staticDir, `${id}.xml`);
  writeFileSync(xmlPath, xml);

  out({
    ok: true,
    id,
    itemCount: data.item?.length || 0,
    cachedAt: xmlPath,
    refreshedAt: new Date().toISOString(),
  });
}

async function cmdServe() {
  await import('./index.js');
}

async function cmdStatus() {
  const { getChromeDebugPort, getChromeTargets } = await import('./browser/cdp.js');
  const { loadFeeds, listFeeds } = await import('./feeds/store.js');
  loadFeeds();

  const port = getChromeDebugPort();
  let chromeStatus: any = { connected: false };
  if (port) {
    try {
      const targets = await getChromeTargets(port);
      chromeStatus = {
        connected: true,
        port,
        pageCount: targets.filter(t => t.type === 'page').length,
      };
    } catch {
      chromeStatus = { connected: false, port, error: 'Cannot reach Chrome' };
    }
  }

  out({
    chrome: chromeStatus,
    feedCount: listFeeds().length,
    serverPort: config.port,
  });
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
