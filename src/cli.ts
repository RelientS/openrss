#!/usr/bin/env node

/**
 * OpenRSS CLI — feed management layer.
 * Browser automation is handled by agent-browser.
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
    case 'register':
    case 'add':          return cmdRegister();
    case 'remove':
    case 'rm':           return cmdRemove(args[1]);
    case 'refresh':      return cmdRefresh(args[1]);
    case 'serve':
    case 'start':        return cmdServe();
    default:             printUsage();
  }
}

function printUsage() {
  console.log(`🗞️  OpenRSS — Turn any website into an RSS feed

Feed Management:
  openrss register '{json}'    Register a feed definition
  openrss list                 List all registered feeds
  openrss remove <id>          Remove a feed
  openrss refresh <id>         Re-execute extraction, cache to static/<id>.xml
  openrss fetch <url>          Fetch public page HTML

Knowledge:
  openrss skills               List built-in site extraction hints
  openrss skill-match <url>    Get selectors/API patterns for a URL

Server:
  openrss serve                Start RSS server on :${config.port}

Browser automation is handled by agent-browser:
  agent-browser open <url>          Navigate
  agent-browser snapshot            Accessibility tree with @refs
  agent-browser eval "js"           Run JavaScript
  agent-browser network requests    List captured API requests
  agent-browser click @ref          Click element
  agent-browser --session-name openrss open <url>  Persist login session
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

async function cmdRefresh(id?: string) {
  if (!id) { console.error('Usage: openrss refresh <id>'); process.exit(1); }

  const { loadFeeds, getFeed } = await import('./feeds/store.js');
  const { renderRSS } = await import('./views/rss.js');
  const { execSync } = await import('node:child_process');
  const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  loadFeeds();
  const feed = getFeed(id);
  if (!feed) { out({ ok: false, error: 'Feed not found' }); return; }

  let data;
  if (feed.strategy === 'browser') {
    // Use agent-browser to navigate and execute
    const sessionFlag = '--session-name openrss';
    execSync(`agent-browser ${sessionFlag} open "${feed.url}"`, { stdio: 'pipe' });
    if (feed.waitFor) {
      execSync(`agent-browser wait "${feed.waitFor}"`, { stdio: 'pipe' });
    } else {
      execSync(`agent-browser wait 3000`, { stdio: 'pipe' });
    }
    const result = execSync(`agent-browser eval '${feed.extractionScript.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    data = JSON.parse(result);
  } else {
    const resp = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 OpenRSS/0.1', 'Accept': 'text/html' },
    });
    const html = await resp.text();
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('html', feed.extractionScript);
    data = await fn(html);
  }

  if (data.items && !data.item) data.item = data.items;

  const staticDir = join(config.feedsDir, '..', 'static');
  if (!existsSync(staticDir)) mkdirSync(staticDir, { recursive: true });
  const xml = renderRSS(data);
  const xmlPath = join(staticDir, `${id}.xml`);
  writeFileSync(xmlPath, xml);

  out({
    ok: true, id,
    itemCount: data.item?.length || 0,
    cachedAt: xmlPath,
    refreshedAt: new Date().toISOString(),
  });
}

async function cmdServe() {
  await import('./index.js');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
