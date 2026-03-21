/**
 * AI-powered content extractor.
 * Given a page's HTML, uses an LLM to identify and extract feed items.
 */

import { chat } from './llm.js';
import type { Data, DataItem } from '../types.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are an RSS feed extraction agent. Given a webpage's HTML content, you must extract a structured feed from it.

Your job:
1. Identify the page title and description
2. Find all repeating content items (articles, posts, videos, products, etc.)
3. For each item, extract: title, link, description/summary, publish date, author, categories

Rules:
- Output ONLY valid JSON, no markdown fences, no explanation
- Links must be absolute URLs. If relative, prepend the base URL.
- Dates should be ISO 8601 format when possible
- Extract as many items as you can find (up to 50)
- If the page has no repeating items, return an empty items array
- Be smart about what constitutes a "feed item" — it could be blog posts, tweets, videos, news articles, product listings, etc.

Output format:
{
  "title": "Feed title",
  "link": "Page URL",
  "description": "Feed description",
  "items": [
    {
      "title": "Item title",
      "link": "https://...",
      "description": "Item summary or content",
      "pubDate": "2024-01-01T00:00:00Z",
      "author": "Author name",
      "category": ["tag1", "tag2"]
    }
  ]
}`;

function truncateHtml(html: string, maxLen = 80000): string {
  // Step 1: Try to extract only the main content area
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i)
    || html.match(/<article[\s\S]*$/i)  // everything from first <article> onward
    || html.match(/<div[^>]*role="main"[\s\S]*?<\/div>/i);

  let source = mainMatch ? mainMatch[0] : html;

  // Step 2: Strip non-content elements
  let cleaned = source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<link[\s\S]*?>/gi, '')
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove verbose attributes
    .replace(/\s(data-hydro-click|data-hydro-click-hmac|data-view-component|data-catalyst|data-action|data-target|data-hovercard-type|data-hovercard-url|data-turbo-frame|data-pjax|aria-label|aria-hidden)="[^"]*"/g, '')
    .replace(/\sclass="[^"]{80,}"/g, ' ')
    // Collapse whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, maxLen) + '\n<!-- truncated -->';
  }
  return cleaned;
}

export async function extractFeed(url: string, html: string, skill?: string): Promise<Data> {
  const cleanedHtml = truncateHtml(html);

  let userPrompt = `Extract an RSS feed from this webpage.

URL: ${url}

HTML content:
${cleanedHtml}`;

  if (skill) {
    userPrompt = `${skill}\n\n${userPrompt}`;
  }

  logger.info(`Extracting feed from ${url} (${cleanedHtml.length} chars)`);

  const response = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);

  // Parse LLM JSON response
  logger.debug('LLM raw response (first 1000 chars):', response.slice(0, 1000));
  let parsed: any;
  try {
    // Try multiple extraction strategies
    // 1. Markdown fences
    const fenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    // 2. First { to last }
    const braceStart = response.indexOf('{');
    const braceEnd = response.lastIndexOf('}');

    let jsonStr: string;
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    } else if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = response.slice(braceStart, braceEnd + 1);
    } else {
      jsonStr = response.trim();
    }

    parsed = JSON.parse(jsonStr);
  } catch (e) {
    logger.error('Failed to parse LLM response as JSON:', response.slice(0, 1000));
    throw new Error('LLM returned invalid JSON');
  }

  return {
    title: parsed.title || `Feed for ${url}`,
    link: parsed.link || url,
    description: parsed.description || '',
    item: (parsed.items || []).map((item: any): DataItem => ({
      title: item.title || '',
      link: item.link || '',
      description: item.description || '',
      pubDate: item.pubDate ? new Date(item.pubDate) : undefined,
      guid: item.link || undefined,
      author: item.author || undefined,
      category: item.category || undefined,
    })),
  };
}
