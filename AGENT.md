# OpenRSS — Agent Integration Guide

OpenRSS turns any website into an RSS feed. You are the intelligence — OpenRSS provides the tools.

## Quick Overview

OpenRSS is a server running at `http://localhost:3000` that provides:
1. **Tools** — Browser automation, HTML fetching, JS evaluation
2. **Feed registry** — Persistent feed definitions that serve RSS/JSON
3. **Skills** — Built-in hints for known websites

Your job: use the tools to figure out how a website's content is structured, write a JavaScript extraction script, then register it as a feed.

## Workflow

### Step 1: Analyze the target URL

For public pages:
```bash
curl -X POST http://localhost:3000/tools/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/news"}'
```

For pages requiring login (Twitter, Bilibili, etc.):
```bash
curl -X POST http://localhost:3000/tools/navigate \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://x.com/elonmusk", "waitFor": "[data-testid=tweet]"}'
```

### Step 2: Check if there's a skill for this site

```bash
curl -X POST http://localhost:3000/tools/skills/match \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://x.com/elonmusk"}'
```

Skills provide extraction hints — selectors, API patterns, page structure.

### Step 3: Write an extraction script

The extraction script is JavaScript that runs in the page context (browser strategy) or receives `html` as a parameter (public strategy).

It must return an object matching this schema:

```javascript
{
  title: "Feed Title",                // required
  link: "https://example.com",        // page URL
  description: "Feed description",    // optional
  items: [                            // required, array of feed items
    {
      title: "Item title",            // required
      link: "https://...",            // item permalink
      description: "Content or summary",
      pubDate: "2024-01-01T00:00:00Z", // ISO 8601
      author: "Author name",
      category: ["tag1", "tag2"]
    }
  ]
}
```

**Browser strategy** example (runs via `page.evaluate(script)`):
```javascript
(function() {
  const items = Array.from(document.querySelectorAll('.article-item')).map(el => ({
    title: el.querySelector('h2')?.textContent?.trim() || '',
    link: el.querySelector('a')?.href || '',
    description: el.querySelector('.summary')?.textContent?.trim() || '',
    pubDate: el.querySelector('time')?.getAttribute('datetime') || '',
    author: el.querySelector('.author')?.textContent?.trim() || '',
  }));
  return {
    title: document.title,
    link: location.href,
    description: document.querySelector('meta[name=description]')?.content || '',
    items,
  };
})()
```

**Public strategy** example (receives `html` as parameter):
```javascript
const items = [];
const pattern = /<article[^>]*>([\s\S]*?)<\/article>/g;
let m;
while ((m = pattern.exec(html)) !== null) {
  const block = m[1];
  const title = block.match(/<h2[^>]*>(.*?)<\/h2>/)?.[1]?.replace(/<[^>]+>/g, '') || '';
  const href = block.match(/href="([^"]+)"/)?.[1] || '';
  items.push({ title, link: href.startsWith('/') ? 'https://example.com' + href : href });
}
return { title: 'My Feed', link: 'https://example.com', items };
```

### Step 4: Test the extraction script

```bash
curl -X POST http://localhost:3000/tools/evaluate \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/news",
    "script": "(function() { ... })()"
  }'
```

### Step 5: Register the feed

```bash
curl -X POST http://localhost:3000/tools/feeds \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "example-news",
    "name": "Example News",
    "url": "https://example.com/news",
    "strategy": "public",
    "extractionScript": "..."
  }'
```

The feed is now permanently served at:
- RSS: `http://localhost:3000/feed/example-news`
- JSON: `http://localhost:3000/feed/example-news?format=json`

## Tools Reference

| Endpoint | Method | Description | Body |
|----------|--------|-------------|------|
| `/tools/fetch` | POST | Fetch URL, return HTML | `{url}` |
| `/tools/navigate` | POST | Navigate browser, return HTML | `{url, waitFor?}` |
| `/tools/evaluate` | POST | Run JS in browser context | `{url, script, waitFor?}` |
| `/tools/cookies` | POST | Get browser cookies | `{domain}` |
| `/tools/status` | GET | Extension connection status | — |
| `/tools/feeds` | POST | Register a feed | `{id, name, url, strategy, extractionScript, waitFor?, interceptPatterns?}` |
| `/tools/feeds` | GET | List all feeds | — |
| `/tools/feeds/:id` | DELETE | Remove a feed | — |
| `/tools/skills` | GET | List built-in skills | — |
| `/tools/skills/match` | POST | Find skill for URL | `{url}` |

## Feed Definition Schema

```typescript
{
  id: string;              // URL-safe slug, e.g. "hn-top", "twitter-elonmusk"
  name: string;            // Human-readable name
  url: string;             // Target URL to fetch/navigate
  strategy: "public" | "browser";  // "public" = direct HTTP, "browser" = Chrome session
  extractionScript: string; // JS that returns {title, link, description, items}
  waitFor?: string;        // CSS selector to wait for before extracting
  interceptPatterns?: string[]; // URL patterns to monkey-patch fetch/XHR
  createdAt: string;       // ISO timestamp (auto-set)
}
```

## Skills

Skills are built-in hints for known websites. They tell you:
- Whether the site needs a browser session
- Key CSS selectors and page structure
- API patterns for SPA sites

Check `/tools/skills` for the full list.
When creating a feed for a known site, read the matching skill first to inform your extraction script.

## Tips for Agents

1. **Start simple** — Try `public` strategy first. Only use `browser` if the page requires login or is SPA-rendered.
2. **Use evaluate to iterate** — Test your extraction script via `/tools/evaluate` before registering.
3. **Check skills first** — `POST /tools/skills/match` may give you a head start.
4. **Absolute URLs** — Ensure all item links are absolute, not relative.
5. **Error handling** — Wrap selectors in optional chaining (`?.`) to handle missing elements.
