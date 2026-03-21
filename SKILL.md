---
description: "OpenRSS — Turn any website into an RSS feed. Use the openrss CLI to fetch pages, analyze HTML, write extraction scripts, and register persistent RSS feeds."
---

# OpenRSS Skill

You have access to the `openrss` CLI tool. Use it to turn any website into an RSS feed by analyzing the page, writing an extraction script, and registering it.

## CLI Reference

All commands output JSON to stdout.

```bash
# Discovery
openrss list                       # List all registered feeds
openrss skills                     # List built-in site knowledge
openrss skill-match <url>          # Get extraction hints for a URL
openrss status                     # Check daemon & extension status

# Page Analysis
openrss fetch <url>                # Fetch URL, returns { html, length }
openrss eval <url> -s "script"     # Run JS in browser page (needs extension)

# Feed Management
openrss register '{"id":"...","url":"...","extractionScript":"..."}'
openrss remove <id>

# Server
openrss serve                      # Start RSS server on :3000
```

## Workflow: Creating a Feed

### Step 1: Check for existing skill

```bash
openrss skill-match "https://news.ycombinator.com"
```

If a skill exists, it provides: selectors, API patterns, whether browser is needed, and sometimes an example extraction script.

### Step 2: Fetch the page

For public pages:
```bash
openrss fetch "https://news.ycombinator.com"
```

For login-required pages (ensure Chrome Extension is loaded):
```bash
openrss eval "https://x.com/elonmusk" -s "document.documentElement.outerHTML" --wait-for "[data-testid=tweet]"
```

### Step 3: Analyze the HTML and write an extraction script

The extraction script is JavaScript that:
- For `public` strategy: receives `html` as a string parameter
- For `browser` strategy: runs in the page context via `page.evaluate()`

It must return:
```javascript
{
  title: "Feed title",
  link: "https://...",
  items: [
    { title: "...", link: "...", description: "...", pubDate: "ISO8601", author: "...", category: ["..."] }
  ]
}
```

### Step 4: Test the script

```bash
openrss eval "https://news.ycombinator.com" -s "(function() {
  const rows = document.querySelectorAll('.athing');
  return {
    title: 'Hacker News',
    link: location.href,
    items: Array.from(rows).map(row => ({
      title: row.querySelector('.titleline > a')?.textContent || '',
      link: row.querySelector('.titleline > a')?.href || '',
    })),
  };
})()"
```

### Step 5: Register the feed

```bash
openrss register '{
  "id": "hn-top",
  "name": "Hacker News Top",
  "url": "https://news.ycombinator.com",
  "strategy": "public",
  "extractionScript": "const items = []; const re = /<span class=\"titleline\"><a href=\"([^\"]+)\">(.*?)<\\/a>/g; let m; while ((m = re.exec(html)) !== null) { items.push({ title: m[2], link: m[1].startsWith(\"http\") ? m[1] : \"https://news.ycombinator.com/\" + m[1] }); } return { title: \"Hacker News\", link: \"https://news.ycombinator.com\", items };"
}'
```

The feed is now served at: `http://localhost:3000/feed/hn-top`

### Step 6: Start the server

```bash
openrss serve
```

## Feed Definition Schema

```json
{
  "id": "url-safe-slug",
  "name": "Human Name",
  "url": "https://target-url.com",
  "strategy": "public | browser",
  "extractionScript": "JS that returns {title, link, items: [...]}",
  "waitFor": "optional CSS selector to wait for",
  "interceptPatterns": ["optional", "URL patterns to intercept fetch/XHR"]
}
```

## Strategy Guide

| Strategy | When to use | Script runs in |
|----------|-------------|----------------|
| `public` | Page is publicly accessible, no JS rendering needed | Node.js (receives `html` param) |
| `browser` | Page needs login session or is SPA-rendered | Browser page context (DOM APIs available) |

## Tips

1. **Start with `public`** — only use `browser` if the page needs login or client-side rendering.
2. **Check skills first** — `openrss skill-match` may give you selectors and API patterns.
3. **Use absolute URLs** — ensure all `link` values in items are absolute.
4. **Test before registering** — use `openrss eval` or `openrss fetch` to verify.
5. **Regex for public, DOM for browser** — public scripts parse HTML strings, browser scripts use `document.querySelector`.
