#!/usr/bin/env node

/**
 * OpenRSS CLI — the interface AI agents use to create and manage RSS feeds.
 *
 * Usage:
 *   openrss list                          List all registered feeds
 *   openrss skills                        List built-in site skills
 *   openrss skill-match <url>             Find skill for a URL
 *   openrss fetch <url>                   Fetch URL and return HTML
 *   openrss evaluate <url> --script "…"   Run JS in browser context
 *   openrss register <json>               Register a feed definition
 *   openrss remove <id>                   Remove a feed
 *   openrss serve                         Start RSS server
 */

import { parseArgs } from 'node:util';
import { config } from './config.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'list':
    case 'ls':
      return cmdList();

    case 'skills':
      return cmdSkills();

    case 'skill-match':
      return cmdSkillMatch(args[1]);

    case 'fetch':
      return cmdFetch(args[1]);

    case 'evaluate':
    case 'eval':
      return cmdEvaluate();

    case 'register':
    case 'add':
      return cmdRegister();

    case 'remove':
    case 'rm':
      return cmdRemove(args[1]);

    case 'serve':
    case 'start':
      return cmdServe();

    case 'status':
      return cmdStatus();

    default:
      printUsage();
  }
}

function printUsage() {
  console.log(`🗞️  OpenRSS — Turn any website into an RSS feed

Commands:
  openrss list                    List all registered feeds
  openrss skills                  List built-in site skills
  openrss skill-match <url>       Find extraction skill for a URL
  openrss fetch <url>             Fetch a URL and return HTML to stdout
  openrss eval <url> -s "script"  Run JS in browser page context
  openrss register '{json}'       Register a feed definition
  openrss remove <id>             Remove a feed
  openrss serve                   Start RSS server (default port ${config.port})
  openrss status                  Check daemon & extension status

Feed Definition JSON:
  {
    "id": "hn-top",
    "name": "Hacker News",
    "url": "https://news.ycombinator.com",
    "strategy": "public",
    "extractionScript": "..."
  }

Output format:
  All commands output JSON to stdout for easy agent parsing.
  Set OPENRSS_FORMAT=pretty for human-readable output.
`);
}

const pretty = process.env.OPENRSS_FORMAT === 'pretty';
function out(data: unknown) {
  console.log(JSON.stringify(data, null, pretty ? 2 : 0));
}

// ── Commands ──

async function cmdList() {
  const { loadFeeds, listFeeds } = await import('./feeds/store.js');
  loadFeeds();
  const feeds = listFeeds();
  out(feeds.map(f => ({
    id: f.id,
    name: f.name,
    url: f.url,
    strategy: f.strategy,
    feedUrl: `http://localhost:${config.port}/feed/${f.id}`,
  })));
}

async function cmdSkills() {
  const { listSkills } = await import('./agent/skills.js');
  out(listSkills().map(s => ({
    match: s.match,
    needsBrowser: s.needsBrowser,
    description: s.description,
    selectors: s.selectors,
    apiPatterns: s.apiPatterns,
    hasExample: !!s.example,
  })));
}

async function cmdSkillMatch(url?: string) {
  if (!url) {
    console.error('Usage: openrss skill-match <url>');
    process.exit(1);
  }
  const { findSkill } = await import('./agent/skills.js');
  const skill = findSkill(url);
  out(skill || { match: null, message: 'No skill found for this URL' });
}

async function cmdFetch(url?: string) {
  if (!url) {
    console.error('Usage: openrss fetch <url>');
    process.exit(1);
  }
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
  // Parse --url and --script flags
  const url = args[1];
  const scriptIdx = args.indexOf('-s') !== -1 ? args.indexOf('-s') : args.indexOf('--script');
  const script = scriptIdx !== -1 ? args[scriptIdx + 1] : undefined;
  const waitIdx = args.indexOf('--wait-for');
  const waitFor = waitIdx !== -1 ? args[waitIdx + 1] : undefined;

  if (!url || !script) {
    console.error('Usage: openrss eval <url> -s "script" [--wait-for "selector"]');
    process.exit(1);
  }

  const { startDaemon } = await import('./browser/daemon.js');
  const { withBrowserPage } = await import('./browser/session.js');
  await startDaemon();

  const result = await withBrowserPage(new URL(url).hostname, async (page) => {
    await page.goto(url);
    if (waitFor) {
      await page.waitForSelector(waitFor);
    } else {
      await page.evaluate('new Promise(r => setTimeout(r, 3000))');
    }
    return page.evaluate(script);
  });
  out({ ok: true, result });
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
  if (!id) {
    console.error('Usage: openrss remove <id>');
    process.exit(1);
  }
  const { loadFeeds, deleteFeed } = await import('./feeds/store.js');
  loadFeeds();
  const ok = deleteFeed(id);
  out({ ok, id });
}

async function cmdServe() {
  // Delegate to the server entry point
  await import('./index.js');
}

async function cmdStatus() {
  const { checkExtensionConnected } = await import('./browser/client.js');
  const { loadFeeds, listFeeds } = await import('./feeds/store.js');
  loadFeeds();
  const connected = await checkExtensionConnected();
  out({
    daemon: `ws://127.0.0.1:${config.daemonPort}`,
    extensionConnected: connected,
    feedCount: listFeeds().length,
    serverPort: config.port,
  });
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
