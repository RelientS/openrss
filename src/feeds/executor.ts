/**
 * Feed executor — runs public feed definitions server-side.
 * Browser feeds are handled by `openrss refresh` via agent-browser.
 */

import type { Data } from '../types.js';
import type { FeedDefinition } from './store.js';

export async function executeFeed(feed: FeedDefinition): Promise<Data> {
  if (feed.strategy !== 'public') {
    throw new Error(`Feed "${feed.id}" uses browser strategy. Run \`openrss refresh ${feed.id}\` instead.`);
  }

  const resp = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 OpenRSS/0.1',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!resp.ok) {
    throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const fn = new AsyncFunction('html', feed.extractionScript);
  return fn(html);
}
