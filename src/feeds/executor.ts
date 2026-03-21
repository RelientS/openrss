/**
 * Feed executor — runs a feed definition and returns RSS-ready Data.
 */

import type { Data } from '../types.js';
import type { FeedDefinition } from './store.js';
import { withBrowserPage } from '../browser/session.js';
import { logger } from '../utils/logger.js';

export async function executeFeed(feed: FeedDefinition): Promise<Data> {
  if (feed.strategy === 'browser') {
    return executeBrowserFeed(feed);
  } else {
    return executePublicFeed(feed);
  }
}

async function executeBrowserFeed(feed: FeedDefinition): Promise<Data> {
  return withBrowserPage(new URL(feed.url).hostname, async (page) => {
    await page.goto(feed.url);

    // Install interceptors if specified
    if (feed.interceptPatterns) {
      for (const pattern of feed.interceptPatterns) {
        await page.installInterceptor(pattern);
      }
    }

    // Wait for specific element if specified
    if (feed.waitFor) {
      await page.waitForSelector(feed.waitFor);
    } else {
      await page.evaluate('new Promise(r => setTimeout(r, 3000))');
    }

    // Run extraction script in page context
    const result = await page.evaluate<Data>(feed.extractionScript);
    return result;
  });
}

async function executePublicFeed(feed: FeedDefinition): Promise<Data> {
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

  // Run extraction script with html as parameter
  // Using indirect eval to avoid template literal escaping issues
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const extractFn = new AsyncFunction('html', feed.extractionScript);
  const result = await extractFn(html);
  return result;
}
