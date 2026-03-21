# 🗞️ OpenRSS

**Turn any website into an RSS feed — powered by AI agents.**

OpenRSS provides the **tools and knowledge** for AI agents (Claude Code, OpenCLI, etc.) to create RSS feeds from any website. You bring the agent, we bring the infrastructure.

```
AI Agent (Claude Code, etc.)
    │  reads AGENT.md to learn tools
    │  uses /tools/* to analyze pages
    │  writes extraction scripts
    │  registers feeds via /tools/feeds
    │
    ▼
OpenRSS Server
    │  serves registered feeds as RSS/JSON
    │  manages browser sessions via Chrome Extension
    │  caches feed results
    │
    ▼
RSS Reader (Reeder, NetNewsWire, etc.)
    subscribes to /feed/:id
```

## Quick Start

```bash
git clone https://github.com/user/openrss.git
cd openrss
npm install
npm run dev
```

Then ask your AI agent:

> "Create an RSS feed for https://news.ycombinator.com using OpenRSS"

The agent will read `AGENT.md`, use the tools API to analyze the page, write an extraction script, and register the feed.

## How It Works

OpenRSS does **not** embed any AI model. Instead, it provides:

1. **Tools API** — HTTP endpoints for fetching pages, running JS in browser, managing feeds
2. **Skills** — Built-in knowledge about known websites (selectors, API patterns, strategies)
3. **Feed Registry** — Persistent feed definitions served as RSS/JSON
4. **Browser Bridge** — Chrome Extension that reuses your login sessions

The AI agent orchestrates everything by calling the tools.

## Tools API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tools/fetch` | POST | Fetch a URL, return HTML |
| `/tools/navigate` | POST | Navigate browser (with login session), return HTML |
| `/tools/evaluate` | POST | Run JS in browser page context |
| `/tools/cookies` | POST | Get browser cookies for a domain |
| `/tools/status` | GET | Check Chrome Extension status |
| `/tools/feeds` | POST | Register a new feed |
| `/tools/feeds` | GET | List all registered feeds |
| `/tools/feeds/:id` | DELETE | Remove a feed |
| `/tools/skills` | GET | List built-in site skills |
| `/tools/skills/match` | POST | Find skill for a URL |

See **[AGENT.md](AGENT.md)** for the full agent integration guide.

## Feed Strategies

| Strategy | Description | Chrome Extension? |
|----------|-------------|-------------------|
| `public` | Direct HTTP fetch — for public pages | No |
| `browser` | Chrome Extension bridge — reuses your login session | Yes |

## Built-in Skills

Skills provide extraction hints for known websites:

- Twitter/X (browser, API interception)
- Bilibili (browser, DOM extraction)
- GitHub Trending (public, HTML parsing)
- YouTube (browser, SPA)
- Reddit (public, old.reddit.com)
- Hacker News (public, DOM extraction)
- Weibo (browser)
- Xiaohongshu (browser)
- Zhihu (browser)

Custom skills can be added as JSON files in the `skills/` directory.

## Browser Extension Setup

For sites requiring login (Twitter, Bilibili, etc.):

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. "Load unpacked" → select the `extension/` directory
4. Browse normally — the extension reuses your existing login sessions

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DAEMON_PORT` | `19826` | Browser bridge port |
| `CACHE_EXPIRE` | `300` | Feed cache TTL (seconds) |
| `FEEDS_DIR` | `./feeds` | Feed definitions directory |

## License

MIT
