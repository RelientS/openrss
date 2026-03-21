/**
 * Feed definition store.
 *
 * A "feed" is a registered extraction recipe:
 * - URL to fetch
 * - Strategy (public / cookie / intercept)
 * - Extraction script (JS to run on the page to extract items)
 *
 * Feed definitions are persisted as JSON files in the feeds/ directory.
 * Agents create these by using the /tools/* endpoints.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface FeedDefinition {
  /** Unique feed ID (URL-safe slug) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Target URL to navigate to */
  url: string;
  /** 'public' = direct fetch, 'browser' = needs Chrome session */
  strategy: 'public' | 'browser';
  /**
   * JavaScript extraction script — runs in page context (for browser strategy)
   * or against fetched HTML (for public strategy via DOM parsing).
   *
   * Must return: { title, link, description, items: [{ title, link, description, pubDate, author, category }] }
   */
  extractionScript: string;
  /** Optional: wait for this selector before extracting */
  waitFor?: string;
  /** Optional: URL patterns to intercept (for SPA API capture) */
  interceptPatterns?: string[];
  /** Created timestamp */
  createdAt: string;
}

const feeds = new Map<string, FeedDefinition>();

function feedsDir(): string {
  const dir = config.feedsDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadFeeds() {
  const dir = feedsDir();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      feeds.set(data.id, data);
      logger.info(`Loaded feed: ${data.id} (${data.name})`);
    } catch (err) {
      logger.warn(`Failed to load feed ${file}:`, err);
    }
  }
  logger.info(`${feeds.size} feeds loaded`);
}

export function getFeed(id: string): FeedDefinition | undefined {
  return feeds.get(id);
}

export function listFeeds(): FeedDefinition[] {
  return [...feeds.values()];
}

export function saveFeed(feed: FeedDefinition) {
  feeds.set(feed.id, feed);
  const dir = feedsDir();
  writeFileSync(join(dir, `${feed.id}.json`), JSON.stringify(feed, null, 2));
  logger.info(`Saved feed: ${feed.id}`);
}

export function deleteFeed(id: string): boolean {
  if (!feeds.has(id)) return false;
  feeds.delete(id);
  const path = join(feedsDir(), `${id}.json`);
  if (existsSync(path)) unlinkSync(path);
  logger.info(`Deleted feed: ${id}`);
  return true;
}
