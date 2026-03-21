/**
 * Skills — site-specific extraction knowledge for AI agents.
 *
 * Each skill describes:
 * - How to identify content items on the page
 * - Key selectors and API patterns
 * - Whether browser session is needed
 *
 * Agents read these to inform their extraction scripts.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

export interface Skill {
  /** Domain patterns to match */
  match: string[];
  /** Whether this site needs browser session */
  needsBrowser: boolean;
  /** Detailed extraction guidance for agents */
  description: string;
  /** Key CSS selectors */
  selectors?: Record<string, string>;
  /** API URL patterns for SPA interception */
  apiPatterns?: string[];
  /** Example extraction script */
  example?: string;
}

const skills = new Map<string, Skill>();

// ── Built-in Skills ──

const builtins: Skill[] = [
  {
    match: ['x.com', 'twitter.com'],
    needsBrowser: true,
    description: 'Twitter/X is a SPA. Best approach: intercept the UserTweets GraphQL API. Navigate to the user profile, install interceptor for "UserTweets", scroll to trigger loading, then collect intercepted responses. Fallback: DOM extraction from [data-testid="tweet"] elements.',
    selectors: {
      tweet: '[data-testid="tweet"]',
      tweetText: '[data-testid="tweetText"]',
      userName: '[data-testid="UserName"]',
      time: 'time[datetime]',
      tweetLink: 'a[href*="/status/"]',
    },
    apiPatterns: ['UserTweets', 'UserTweetsAndReplies', 'SearchTimeline'],
    example: `(function() {
  const tweets = document.querySelectorAll('[data-testid="tweet"]');
  return {
    title: document.querySelector('[data-testid="UserName"] span')?.textContent + ' - Twitter',
    link: location.href,
    items: Array.from(tweets).slice(0, 20).map(t => ({
      title: t.querySelector('[data-testid="tweetText"]')?.textContent?.slice(0, 200) || '',
      link: 'https://x.com' + (t.querySelector('a[href*="/status/"]')?.getAttribute('href') || ''),
      description: t.querySelector('[data-testid="tweetText"]')?.textContent || '',
      pubDate: t.querySelector('time')?.getAttribute('datetime') || '',
    })),
  };
})()`,
  },
  {
    match: ['bilibili.com'],
    needsBrowser: true,
    description: 'Bilibili user video pages. Navigate to space.bilibili.com/{uid}/video. Videos are in .small-item or .video-card containers. Bilibili has anti-scraping, browser session helps bypass it.',
    selectors: {
      videoCard: '.small-item, .video-card',
      videoLink: 'a[href*="/video/"]',
      videoTitle: '.title',
      uploader: '.nickname, #h-name',
      duration: '.duration',
    },
  },
  {
    match: ['github.com/trending'],
    needsBrowser: false,
    description: 'GitHub Trending page. Each repo is in an <article class="Box-row">. The repo link is inside an <h2> with a nested <a href="/owner/repo">. Description is in a <p> tag. Language in [itemprop="programmingLanguage"]. Star count near the end of each article.',
    selectors: {
      article: 'article.Box-row',
      repoLink: 'h2 a[href^="/"]',
      description: 'p.col-9',
      language: '[itemprop="programmingLanguage"]',
    },
  },
  {
    match: ['youtube.com'],
    needsBrowser: true,
    description: 'YouTube is a SPA. For channel pages, navigate to /channel/ID/videos or /@handle/videos. Video items are in ytd-rich-item-renderer or ytd-grid-video-renderer. Titles in #video-title, links in a#thumbnail.',
    selectors: {
      videoItem: 'ytd-rich-item-renderer, ytd-grid-video-renderer',
      title: '#video-title',
      thumbnail: 'a#thumbnail',
      channel: '#channel-name',
      metadata: '#metadata-line span',
    },
  },
  {
    match: ['reddit.com'],
    needsBrowser: false,
    description: 'Reddit. Use old.reddit.com for simpler HTML. Posts are in .thing[data-fullname] containers on old.reddit.com, or shreddit-post on new reddit. Titles in a.title, score in .score, time in time[datetime].',
    selectors: {
      post: '.thing[data-fullname]',
      title: 'a.title',
      score: '.score.unvoted',
      time: 'time[datetime]',
      author: '.author',
      comments: '.comments',
    },
  },
  {
    match: ['news.ycombinator.com'],
    needsBrowser: false,
    description: 'Hacker News. Items are in .athing rows. Title in .titleline > a. Score in .score. Author in .hnuser. Time in .age[title]. Comments link in the subtext row.',
    selectors: {
      item: '.athing',
      title: '.titleline > a',
      score: '.score',
      author: '.hnuser',
      age: '.age',
      sitebit: '.sitebit',
    },
    example: `(function() {
  const rows = document.querySelectorAll('.athing');
  const items = Array.from(rows).map(row => {
    const titleEl = row.querySelector('.titleline > a');
    const sub = row.nextElementSibling;
    return {
      title: titleEl?.textContent || '',
      link: titleEl?.href || '',
      author: sub?.querySelector('.hnuser')?.textContent || '',
      pubDate: sub?.querySelector('.age')?.getAttribute('title') || '',
    };
  });
  return { title: 'Hacker News', link: 'https://news.ycombinator.com', items };
})()`,
  },
  {
    match: ['weibo.com'],
    needsBrowser: true,
    description: 'Weibo requires login for most content. Posts are in .card-wrap or [action-type="feed_list_item"]. Text in .txt, time in .from a, images in .media img.',
    selectors: {
      post: '.card-wrap, [action-type="feed_list_item"]',
      text: '.txt',
      time: '.from a',
      images: '.media img',
    },
  },
  {
    match: ['xiaohongshu.com'],
    needsBrowser: true,
    description: 'Xiaohongshu (RED). Notes are displayed as cards. Need browser session. Note cards contain cover images, titles, author info, and like counts.',
    selectors: {
      noteCard: '.note-item, .feeds-container section',
      title: '.title, .note-content',
      author: '.author-wrapper .name',
      likes: '.like-wrapper .count',
    },
  },
  {
    match: ['zhihu.com'],
    needsBrowser: true,
    description: 'Zhihu. Answers are in .ContentItem. Article titles in .ContentItem-title a. Content in .RichContent-inner. Author in .AuthorInfo-name. Upvotes in .VoteButton--up.',
    selectors: {
      item: '.ContentItem',
      title: '.ContentItem-title a',
      content: '.RichContent-inner',
      author: '.AuthorInfo-name',
      upvotes: '.VoteButton--up',
      time: '.ContentItem-time',
    },
  },
];

for (const skill of builtins) {
  for (const domain of skill.match) {
    skills.set(domain, skill);
  }
}

// ── Custom Skills ──

export function loadSkillsFromDir(dir: string) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const skill: Skill = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      for (const domain of skill.match) {
        skills.set(domain, skill);
        logger.info(`Loaded custom skill: ${domain}`);
      }
    } catch (err) {
      logger.warn(`Failed to load skill ${file}:`, err);
    }
  }
}

export function findSkill(url: string): Skill | undefined {
  for (const [domain, skill] of skills) {
    if (url.includes(domain)) return skill;
  }
  return undefined;
}

export function listSkills(): Skill[] {
  const seen = new Set<Skill>();
  const result: Skill[] = [];
  for (const skill of skills.values()) {
    if (seen.has(skill)) continue;
    seen.add(skill);
    result.push(skill);
  }
  return result;
}
