/**
 * Skill system — site-specific extraction hints for the AI agent.
 *
 * Skills are short prompt fragments that tell the LLM how to best extract
 * content from a specific site. They can be loaded from YAML files in
 * the skills/ directory or defined inline.
 *
 * A skill matches when the URL contains the skill's domain pattern.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

interface Skill {
  /** Domain pattern to match (e.g. "twitter.com", "x.com") */
  match: string[];
  /** Prompt hint for the LLM */
  prompt: string;
  /** Whether this site needs browser session */
  needsBrowser: boolean;
}

const skills = new Map<string, Skill>();

// ── Built-in skills ──

const builtinSkills: Skill[] = [
  {
    match: ['x.com', 'twitter.com'],
    prompt: `This is Twitter/X. Look for tweet items which typically have:
- Tweet text content
- Author name and handle
- Timestamp
- Tweet permalink (https://x.com/user/status/ID)
Focus on the main timeline tweets, ignore promoted content and "who to follow" suggestions.`,
    needsBrowser: true,
  },
  {
    match: ['bilibili.com'],
    prompt: `This is Bilibili (Chinese video platform). Look for video items which have:
- Video title
- Video URL (https://www.bilibili.com/video/BVXXXX)
- Author/uploader name
- View count, duration
- Upload date
- Thumbnail image`,
    needsBrowser: true,
  },
  {
    match: ['github.com/trending'],
    prompt: `This is GitHub Trending. Each repository entry has:
- Repository full name (owner/repo)
- Description
- Programming language
- Star count (today/this week/this month)
- Fork count
- Link: https://github.com/owner/repo`,
    needsBrowser: false,
  },
  {
    match: ['youtube.com', 'youtu.be'],
    prompt: `This is YouTube. Look for video items with:
- Video title
- Video URL (https://www.youtube.com/watch?v=ID)
- Channel name
- View count
- Upload date / "X days ago"
- Thumbnail`,
    needsBrowser: true,
  },
  {
    match: ['reddit.com'],
    prompt: `This is Reddit. Look for post items with:
- Post title
- Post URL (permalink)
- Subreddit name
- Author
- Score (upvotes)
- Comment count
- Post time`,
    needsBrowser: false,
  },
  {
    match: ['weibo.com'],
    prompt: `This is Weibo (Chinese social media). Look for post/tweet items with:
- Post text content
- Author name
- Post time
- Post permalink
- Any attached images`,
    needsBrowser: true,
  },
  {
    match: ['xiaohongshu.com'],
    prompt: `This is Xiaohongshu (RED/Little Red Book). Look for note items with:
- Note title
- Note URL
- Author name
- Like count
- Cover image`,
    needsBrowser: true,
  },
  {
    match: ['zhihu.com'],
    prompt: `This is Zhihu (Chinese Q&A platform). Look for answer/article items with:
- Title (question or article title)
- Content excerpt
- Author name
- Upvote count
- Answer/article URL
- Publish date`,
    needsBrowser: true,
  },
];

// Register built-in skills
for (const skill of builtinSkills) {
  for (const domain of skill.match) {
    skills.set(domain, skill);
  }
}

// ── Load custom skills from files ──

export function loadSkillsFromDir(dir: string) {
  if (!existsSync(dir)) return;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.txt') && !file.endsWith('.md')) continue;
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const lines = content.split('\n');

      // First line: comma-separated domain patterns
      // Second line: "browser: true/false"
      // Rest: prompt
      const match = lines[0]?.split(',').map(s => s.trim()).filter(Boolean) || [];
      const needsBrowser = lines[1]?.toLowerCase().includes('true') ?? false;
      const prompt = lines.slice(2).join('\n').trim();

      if (match.length && prompt) {
        const skill: Skill = { match, prompt, needsBrowser };
        for (const domain of match) {
          skills.set(domain, skill);
          logger.info(`Loaded custom skill for: ${domain}`);
        }
      }
    } catch (err) {
      logger.warn(`Failed to load skill ${file}:`, err);
    }
  }
}

// ── Lookup ──

export function findSkill(url: string): Skill | undefined {
  for (const [domain, skill] of skills) {
    if (url.includes(domain)) return skill;
  }
  return undefined;
}

export function listSkills(): Array<{ domains: string[]; needsBrowser: boolean }> {
  const seen = new Set<Skill>();
  const result: Array<{ domains: string[]; needsBrowser: boolean }> = [];
  for (const skill of skills.values()) {
    if (seen.has(skill)) continue;
    seen.add(skill);
    result.push({ domains: skill.match, needsBrowser: skill.needsBrowser });
  }
  return result;
}
