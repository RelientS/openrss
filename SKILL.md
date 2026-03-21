---
description: "OpenRSS — Turn any website into an RSS feed. Use `openrss` CLI to discover APIs, write extraction scripts, and register persistent feeds. Supports public pages and login-required sites via Chrome CDP."
---

# OpenRSS Skill

Use the `openrss` CLI to turn any website into an RSS feed. All commands output JSON to stdout.

## CLI Reference

```bash
# Discovery & Analysis
openrss fetch <url>                    # Fetch public page HTML
openrss eval <url> -s "js" [--wait-for "sel"] [--no-navigate]  # Run JS in Chrome via CDP
openrss discover <url>                 # Capture all API requests, score likely data endpoints

# Feed Management
openrss register '{"id":"...", "url":"...", "extractionScript":"..."}'
openrss list                           # List registered feeds
openrss remove <id>                    # Delete a feed
openrss refresh <id>                   # Re-execute feed script, cache result to static/<id>.xml

# Knowledge
openrss skills                         # Built-in site extraction hints
openrss skill-match <url>              # Get selectors/API patterns for a URL
openrss status                         # Chrome CDP connection + feed count

# Server
openrss serve                          # Start RSS server on :3000
```

## Path A: Public Pages (no login needed)

For sites like Hacker News, GitHub Trending, Reddit.

```bash
# 1. Check skill
openrss skill-match "https://news.ycombinator.com"

# 2. Fetch HTML
openrss fetch "https://news.ycombinator.com"

# 3. Write extraction script (receives `html` as string param)
# 4. Register
openrss register '{"id":"hn","url":"https://news.ycombinator.com","strategy":"public","extractionScript":"..."}'

# 5. Feed available at /feed/hn
```

**Public extraction scripts** receive `html` as a string parameter. Use regex to parse:
```javascript
const items = [];
const re = /<span class="titleline"><a href="([^"]+)">(.*?)<\/a>/g;
let m;
while ((m = re.exec(html)) !== null) {
  items.push({ title: m[2], link: m[1] });
}
return { title: 'My Feed', link: 'https://example.com', items };
```

## Path B: Login-Required Sites (browser strategy)

For sites like ByteTech, Twitter, Bilibili — pages behind SSO/OAuth.

**Prerequisites**: Chrome must be running with the target site already logged in.

### Step 1: Discover data APIs

```bash
openrss discover "https://bytetech.info/topic"
```

This navigates Chrome to the URL, captures all XHR/Fetch requests, and scores them:
```json
{
  "apis": [
    {"url": "/proxy_tech_api/v1/content/topic/feed", "method": "POST", "score": 8, "itemCount": 10, "hint": "⭐ likely data API"},
    {"url": "/proxy_tech_api/v1/content/application/list", "method": "POST", "score": 5, "hint": "🔍 possible data API"}
  ]
}
```

### Step 2: Investigate API parameters

Use `openrss eval` with `--no-navigate` to run JS on the current page (already navigated by discover):

```bash
openrss eval "https://bytetech.info" --no-navigate -s "
  fetch('/proxy_tech_api/v1/content/topic/feed', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sort: 2, cursor: '1', limit: 5})
  }).then(r => r.json())
"
```

To find filter parameters (e.g., a specific product/category):
1. Install a fetch interceptor: `openrss eval <url> -s "..." ` that patches `window.fetch`
2. Click the filter element via Chrome DevTools MCP (`mcp: click`)
3. Read the intercepted request to find the new parameter

### Step 3: Write browser extraction script

**Browser extraction scripts** run in Chrome page context. They can call `fetch()` (with cookies), use DOM APIs, etc.

```javascript
(async function() {
  const resp = await fetch('/api/v1/feed', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sort: 2, limit: 50, filter_id: '123'})
  });
  const data = await resp.json();
  return {
    title: 'My Feed',
    link: location.href,
    items: data.items.map(item => ({
      title: item.title,
      link: 'https://example.com/post/' + item.id,
      description: item.content.substring(0, 800),
      pubDate: new Date(item.created_at * 1000).toISOString(),
      author: item.author_name,
    }))
  };
})()
```

### Step 4: Test the script

```bash
openrss eval "https://bytetech.info/topic" -s "(async function() { ... })()"
```

### Step 5: Register the feed

```bash
openrss register '{"id":"bytetech-openclaw","name":"ByteTech OpenClaw","url":"https://bytetech.info/topic","strategy":"browser","extractionScript":"(async function() { ... })()"}'
```

### Step 6: Refresh and cache

```bash
# Execute the script and save result as static XML
openrss refresh bytetech-openclaw
# Output: { ok: true, itemCount: 48, cachedAt: "static/bytetech-openclaw.xml" }
```

For recurring refresh, set up a cron or use the server's cache mechanism.

## Feed Definition Schema

```json
{
  "id": "url-safe-slug",
  "name": "Human-readable name",
  "url": "https://target-url.com",
  "strategy": "public | browser",
  "extractionScript": "JS that returns {title, link, items: [{title, link, description, pubDate, author, category}]}",
  "waitFor": "(optional) CSS selector to wait for before extracting",
  "interceptPatterns": ["(optional)", "URL patterns to intercept"],
  "refreshInterval": "(optional) seconds between auto-refreshes"
}
```

## Chrome DevTools MCP Integration

When `openrss eval` or `openrss discover` can't connect to Chrome directly (no DevToolsActivePort), you can use Chrome DevTools MCP tools as a fallback:

| OpenRSS CLI | Chrome DevTools MCP equivalent |
|---|---|
| `openrss eval <url> -s "script"` | `mcp: navigate_page` then `mcp: evaluate_script` |
| `openrss discover <url>` | `mcp: navigate_page` then `mcp: list_network_requests` |
| Click / interact with page | `mcp: click`, `mcp: type_text` |
| Take screenshot | `mcp: take_screenshot` |

The manual MCP path works identically — just register the final extraction script with `openrss register`.

## Tips

1. **Always try `openrss discover` first** for login-required sites — it identifies data APIs automatically.
2. **Use `--no-navigate`** when the page is already open from a previous command.
3. **`openrss refresh`** caches XML to `static/` — serve with `python3 -m http.server` or `openrss serve`.
4. **Absolute URLs** — ensure all item `link` values are absolute.
5. **Browser scripts** run in page context: `fetch()`, `document.querySelector()`, `location.href` all work.
6. **Public scripts** receive `html` string: use regex or string matching, no DOM APIs.
