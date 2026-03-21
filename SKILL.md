---
description: "OpenRSS — Turn any website into an RSS feed. Combines agent-browser for browser automation with openrss for feed management. Supports public pages and login-required sites."
---

# OpenRSS Skill

Turn any website into an RSS feed using two CLI tools:
- **agent-browser** — browser automation (navigate, snapshot, eval JS, capture network)
- **openrss** — feed management (register, refresh, serve)

## Quick Reference

```bash
# Browser (agent-browser)
agent-browser open <url>                    # Navigate
agent-browser snapshot                      # Accessibility tree with @refs
agent-browser eval "document.title"         # Run JavaScript
agent-browser network requests              # List captured API requests
agent-browser click @ref                    # Click element by ref
agent-browser --session-name openrss open <url>  # Persistent login session

# Feeds (openrss)
openrss register '{"id":"...","url":"...","strategy":"...","extractionScript":"..."}'
openrss list                                # List feeds
openrss refresh <id>                        # Execute script, cache XML
openrss serve                               # Serve feeds on :3000
openrss skills                              # Built-in site hints
openrss skill-match <url>                   # Get hints for a URL
```

## Path A: Public Pages

For Hacker News, GitHub Trending, Reddit, etc.

```bash
# 1. Check for skill hints
openrss skill-match "https://news.ycombinator.com"

# 2. Fetch HTML
openrss fetch "https://news.ycombinator.com"

# 3. Write extraction script (receives `html` string, returns {title, link, items})
# 4. Register
openrss register '{"id":"hn","url":"https://news.ycombinator.com","strategy":"public","extractionScript":"..."}'

# 5. Refresh to generate static XML
openrss refresh hn
```

**Public scripts** receive `html` as parameter. Use regex:
```javascript
const items = [];
const re = /<a href="([^"]+)">(.*?)<\/a>/g;
let m;
while ((m = re.exec(html)) !== null) {
  items.push({ title: m[2], link: m[1] });
}
return { title: 'Feed', link: 'https://example.com', items };
```

## Path B: Login-Required Sites

For ByteTech, Twitter, Bilibili, internal platforms — anything behind SSO.

### Step 1: Open the page with login session

```bash
agent-browser --session-name openrss open "https://bytetech.info/topic"
agent-browser wait --load networkidle
agent-browser screenshot                    # Verify page loaded correctly
```

The `--session-name` flag persists cookies/login across commands.

### Step 2: Discover data APIs

```bash
agent-browser network requests
```

Look for JSON API endpoints — POST requests to `/api/`, `/v1/`, paths containing `feed`, `list`, `topic`, etc. Note the URL, method, and any parameters.

If no requests are captured yet, scroll or interact to trigger loading:
```bash
agent-browser scroll down 500
agent-browser network requests
```

### Step 3: Investigate API parameters

To find filter parameters (e.g., selecting a specific category):

```bash
# Take a snapshot to find the filter element
agent-browser snapshot

# Click the filter dropdown
agent-browser click @e15

# Wait and check new network requests
agent-browser wait 2000
agent-browser network requests --filter "api"
```

Compare before/after requests to identify the new parameter.

### Step 4: Test extraction script in browser

```bash
agent-browser eval "(async () => {
  const resp = await fetch('/api/v1/content/feed', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sort: 2, limit: 50, filter_id: '123'})
  });
  const data = await resp.json();
  return {
    title: 'My Feed',
    link: location.href,
    items: data.data.items.map(item => ({
      title: item.title,
      link: 'https://example.com/post/' + item.id,
      description: item.content.substring(0, 500),
      pubDate: new Date(item.created_at * 1000).toISOString(),
      author: item.author_name,
    }))
  };
})()"
```

### Step 5: Register the feed

```bash
openrss register '{"id":"bytetech-openclaw","name":"ByteTech OpenClaw","url":"https://bytetech.info/topic","strategy":"browser","extractionScript":"(async () => { ... })()"}'
```

### Step 6: Refresh and serve

```bash
# Generate cached RSS XML (uses agent-browser under the hood)
openrss refresh bytetech-openclaw

# Serve
openrss serve
# → http://localhost:3000/feed/bytetech-openclaw
```

For recurring refresh, use cron:
```bash
# Every hour
0 * * * * cd /path/to/openrss && openrss refresh bytetech-openclaw 2>/dev/null
```

## Feed Definition Schema

```json
{
  "id": "url-safe-slug",
  "name": "Human-readable name",
  "url": "https://target-url.com",
  "strategy": "public | browser",
  "extractionScript": "JS returning {title, link, items: [{title, link, description, pubDate, author, category}]}",
  "waitFor": "(optional) CSS selector to wait for"
}
```

| Strategy | Extraction | Refresh mechanism |
|----------|-----------|-------------------|
| `public` | Server-side (Node.js, receives `html` string) | Live on request or `openrss refresh` |
| `browser` | Client-side (via `agent-browser eval`) | `openrss refresh` only → caches to `static/` |

## Tips

1. **`agent-browser snapshot`** is your best friend — it shows the page structure with clickable `@refs`, uses minimal context.
2. **`agent-browser network requests`** captures API calls automatically — look for JSON endpoints with list data.
3. **`--session-name openrss`** preserves login state across agent-browser commands.
4. **Always test with `agent-browser eval`** before registering with `openrss register`.
5. **For SPA sites**: use `agent-browser wait --load networkidle` after navigation to ensure content loads.
6. **`openrss refresh`** writes static XML to `static/<id>.xml` — the server serves this directly with no re-execution.
