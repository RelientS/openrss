import type { Route } from '../../types.js';

export const route: Route = {
  path: '/trending/:since/:language?',
  name: 'Trending',
  example: '/github/trending/daily/javascript',
  strategy: 'public', // GitHub Trending is public, no login needed
  parameters: {
    since: 'daily | weekly | monthly',
    language: 'Programming language (e.g. javascript, python, rust). Omit for all.',
  },

  handler: async (ctx, page) => {
    const since = ctx.req.param('since') || 'daily';
    const language = ctx.req.param('language') || '';

    const url = language
      ? `https://github.com/trending/${language}?since=${since}`
      : `https://github.com/trending?since=${since}`;

    // Public route — use direct fetch (no browser needed)
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) OpenRSS/0.1',
        'Accept': 'text/html',
      },
    });
    const html = await resp.text();

    // Parse trending repos from HTML
    const items: Array<{
      title: string;
      description: string;
      link: string;
      author: string;
      stars: string;
      language: string;
    }> = [];

    // Simple regex parsing (no cheerio dependency for now)
    const repoPattern = /<article class="Box-row">([\s\S]*?)<\/article>/g;
    let match;
    while ((match = repoPattern.exec(html)) !== null) {
      const block = match[1];

      // Repo name — match the h2 heading link (not the star/fork buttons)
      const nameMatch = block.match(/<h2[\s\S]*?<a[\s\S]*?href="\/([^"]+)"[\s\S]*?<\/a>/);
      const fullName = nameMatch?.[1]?.trim() || '';

      // Description
      const descMatch = block.match(/<p class="[^"]*">([\s\S]*?)<\/p>/);
      const desc = descMatch?.[1]?.trim().replace(/<[^>]+>/g, '').trim() || '';

      // Stars
      const starsMatch = block.match(/(\d[\d,]*)\s*stars?\s*today/i)
        || block.match(/class="d-inline-block float-sm-right"[\s\S]*?([\d,]+)/);
      const stars = starsMatch?.[1] || '';

      // Language
      const langMatch = block.match(/itemprop="programmingLanguage">(.*?)<\/span>/);
      const lang = langMatch?.[1]?.trim() || '';

      if (fullName) {
        items.push({
          title: fullName,
          description: `${desc}${lang ? `\n\nLanguage: ${lang}` : ''}${stars ? `\nStars today: ${stars}` : ''}`,
          link: `https://github.com/${fullName}`,
          author: fullName.split('/')[0],
          stars,
          language: lang,
        });
      }
    }

    const sinceLabel = { daily: 'today', weekly: 'this week', monthly: 'this month' }[since] || since;

    return {
      title: `GitHub Trending ${language || 'All Languages'} — ${sinceLabel}`,
      link: url,
      description: `Trending repositories on GitHub ${sinceLabel}`,
      item: items.map((repo) => ({
        title: repo.title,
        description: repo.description,
        link: repo.link,
        guid: `${repo.link}#${since}`,
        author: repo.author,
        category: repo.language ? [repo.language] : undefined,
      })),
    };
  },
};
