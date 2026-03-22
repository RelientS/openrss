# 🗞️ OpenRSS

**Turn any website into an RSS feed — powered by AI agents.**

OpenRSS provides feed management tools that pair with [agent-browser](https://github.com/vercel-labs/agent-browser) for browser automation. AI agents (Claude Code, Codex, etc.) compose both to create RSS feeds from any website.

```
AI Agent (reads SKILL.md)
    ├── agent-browser open/snapshot/eval/network  → browser automation
    └── openrss register/refresh/serve            → feed management
                                                       ↓
                                                  RSS Reader subscribes to /feed/:id
```

## Install

### As an Agent Skill (recommended)

```bash
npx skills add RelientS/openrss
```

This installs the skill to Claude Code, Codex, Cursor, Gemini CLI, Trae, and 36+ more agents.

### CLI only

```bash
npm install -g openrss agent-browser
```

## Usage

### For AI Agents

After installing the skill, just ask your agent:

> "Create an RSS feed for https://news.ycombinator.com using OpenRSS"

Then ask Claude Code:

> "Create an RSS feed for https://news.ycombinator.com using OpenRSS"

### Manual Usage

**Public page:**
```bash
# Fetch and analyze
openrss fetch "https://news.ycombinator.com"

# Register with extraction script
openrss register '{"id":"hn","url":"https://news.ycombinator.com","strategy":"public","extractionScript":"..."}'

# Generate cached XML
openrss refresh hn

# Serve
openrss serve
# → http://localhost:3000/feed/hn
```

**Login-required page:**
```bash
# Open in browser (reuses Chrome login)
agent-browser --session-name openrss open "https://internal-site.com/feed"

# Discover data APIs
agent-browser network requests

# Test extraction in browser context
agent-browser eval "(async () => { ... })()"

# Register and refresh
openrss register '{"id":"internal","url":"...","strategy":"browser","extractionScript":"..."}'
openrss refresh internal
```

## CLI Reference

```
openrss register '{json}'    Register a feed definition
openrss list                 List all registered feeds
openrss remove <id>          Remove a feed
openrss refresh <id>         Execute extraction, cache to static/<id>.xml
openrss fetch <url>          Fetch public page HTML
openrss skills               List built-in site hints
openrss skill-match <url>    Get extraction hints for a URL
openrss serve                Start RSS server on :3000
```

## Architecture

```
┌─────────────────────────────────┐
│  agent-browser (Vercel)         │  Browser automation layer
│  open / snapshot / eval         │  Handles login, SPA, network capture
│  network / click / type         │
└──────────────┬──────────────────┘
               │ stdout (JSON)
┌──────────────▼──────────────────┐
│  openrss                        │  Feed management layer
│  register / refresh / serve     │  Persists definitions, generates RSS XML
│  skills / skill-match           │  Provides site extraction knowledge
└──────────────┬──────────────────┘
               │ static/<id>.xml
┌──────────────▼──────────────────┐
│  RSS Reader                     │  Reeder, NetNewsWire, Inoreader, etc.
│  subscribes to /feed/:id        │
└─────────────────────────────────┘
```

## Built-in Skills

Site extraction hints for: Twitter/X, Bilibili, GitHub Trending, YouTube, Reddit, Hacker News, Weibo, Xiaohongshu, Zhihu.

Custom skills: add JSON files to `skills/` directory.

## License

MIT
