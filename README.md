# 🗞️ OpenRSS

**Turn any website into an RSS feed. Zero config — reuses your browser login sessions.**

OpenRSS combines the best of [RSSHub](https://github.com/DIYgod/RSSHub) and [OpenCLI](https://github.com/jackwener/opencli):
- **RSSHub's approach**: Self-hosted server that outputs standard RSS/Atom/JSON feeds
- **OpenCLI's approach**: Reuses your Chrome browser sessions — no API keys, no cookies to configure

## How it works

```
RSS Reader ──GET──▶ OpenRSS Server ──▶ Chrome Extension Bridge ──▶ Your Chrome (logged in)
                        │                                               │
                        │◀──────────── RSS XML ◀── Data ◀──────────────│
```

1. Your RSS reader requests a feed URL from OpenRSS
2. OpenRSS sends a command to the Chrome Extension (running in your browser)
3. The extension opens an automation tab, navigates to the target site **with your existing login session**
4. Data is extracted via API interception or DOM parsing
5. OpenRSS converts it to standard RSS XML and returns it

**No API keys. No cookies. No tokens. Just open Chrome and browse normally.**

## Quick Start

### 1. Install & Start

```bash
git clone https://github.com/user/openrss.git
cd openrss
npm install
npm run dev
```

### 2. Load the Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `extension/` directory
4. The extension will auto-connect to the OpenRSS daemon

### 3. Subscribe

```
# Twitter user timeline (needs Chrome login)
http://localhost:3000/twitter/user/elonmusk

# GitHub Trending (public, no browser needed)
http://localhost:3000/github/trending/daily/javascript

# Bilibili user videos (needs Chrome login)
http://localhost:3000/bilibili/user/2267573
```

Add these URLs to any RSS reader (Reeder, NetNewsWire, Inoreader, etc.).

## Route Strategies

Each route declares its authentication strategy:

| Strategy | Description | Browser needed? |
|----------|-------------|-----------------|
| `public` | No auth required, direct HTTP fetch | No |
| `cookie` | Reuses browser cookies/session | Yes |
| `intercept` | Captures SPA API calls via fetch/XHR monkey-patch | Yes |

## Available Routes

| Route | Strategy | Description |
|-------|----------|-------------|
| `/twitter/user/:id` | `intercept` | User tweet timeline |
| `/github/trending/:since/:language?` | `public` | Trending repositories |
| `/bilibili/user/:uid` | `cookie` | User video list |

## Adding a New Route

Create two files:

**`src/routes/mysite/namespace.ts`**
```typescript
import type { Namespace } from '../../types.js';

export const namespace: Namespace = {
  name: 'My Site',
  url: 'https://mysite.com',
};
```

**`src/routes/mysite/feed.ts`**
```typescript
import type { Route } from '../../types.js';

export const route: Route = {
  path: '/feed/:id',
  name: 'My Feed',
  example: '/mysite/feed/123',
  strategy: 'cookie',

  handler: async (ctx, page) => {
    await page.goto('https://mysite.com/user/' + ctx.req.param('id'));
    const items = await page.evaluate(`...`);
    return {
      title: 'My Feed',
      item: items,
    };
  },
};
```

Then register it in `src/app.ts`.

## Query Parameters

| Parameter | Description |
|-----------|-------------|
| `?format=json` | Output as JSON Feed instead of RSS XML |
| `?format=rss` | Output as RSS 2.0 XML (default) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   RSS Reader                         │
│              (Reeder, NetNewsWire, etc.)             │
└────────────────────┬────────────────────────────────┘
                     │ HTTP GET
┌────────────────────▼────────────────────────────────┐
│              OpenRSS Server (Hono)                   │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐    │
│  │  Cache    │→ │  Router   │→ │ Template (RSS) │    │
│  └──────────┘  └────┬─────┘  └────────────────┘    │
│                      │                               │
│           ┌──────────▼──────────┐                   │
│           │  Route Handler       │                   │
│           │  (Twitter/GitHub/..) │                   │
│           └──────────┬──────────┘                   │
│                      │                               │
│  ┌───────────────────▼───────────────────────┐      │
│  │          Browser Bridge (Daemon)           │      │
│  │     HTTP + WebSocket on 127.0.0.1:19826   │      │
│  └───────────────────┬───────────────────────┘      │
└──────────────────────┼──────────────────────────────┘
                       │ WebSocket
┌──────────────────────▼──────────────────────────────┐
│           Chrome Extension (Service Worker)          │
│                                                      │
│  • Runs inside your normal Chrome profile            │
│  • Has access to all your login sessions             │
│  • Opens automation tabs (hidden from your browsing) │
│  • Executes commands via chrome.debugger CDP         │
└──────────────────────────────────────────────────────┘
```

## Configuration

All via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DAEMON_PORT` | `19826` | Browser bridge daemon port |
| `CACHE_EXPIRE` | `300` | Route cache TTL (seconds) |
| `CACHE_MAX` | `256` | Max cached entries |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `PROXY_URI` | — | SOCKS5/HTTP proxy for public routes |

## License

MIT
