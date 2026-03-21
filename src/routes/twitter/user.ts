import type { Route } from '../../types.js';

export const route: Route = {
  path: '/user/:id',
  name: 'User Timeline',
  example: '/twitter/user/elonmusk',
  strategy: 'intercept',
  parameters: {
    id: 'Twitter username',
  },

  handler: async (ctx, page) => {
    if (!page) throw new Error('Browser page required');

    const username = ctx.req.param('id');

    // Navigate to user's profile — this triggers Twitter's SPA to load
    await page.goto(`https://x.com/${username}`);

    // Install interceptor to capture the UserTweets API response
    await page.installInterceptor('UserTweets');

    // Scroll to trigger API call loading tweets
    await page.evaluate(`
      window.scrollBy(0, 800);
      await new Promise(r => setTimeout(r, 2000));
      window.scrollBy(0, 800);
      await new Promise(r => setTimeout(r, 1000));
    `);

    // Wait a bit for API responses to come through
    await page.evaluate('new Promise(r => setTimeout(r, 3000))');

    // Collect intercepted API responses
    const requests = await page.getInterceptedRequests();

    // Extract user info and tweets from the API response
    const userInfo = await page.evaluate(`
      (function() {
        const nameEl = document.querySelector('[data-testid="UserName"]');
        const name = nameEl?.querySelector('span')?.textContent || '${username}';
        const bio = document.querySelector('[data-testid="UserDescription"]')?.textContent || '';
        const avatar = document.querySelector('[data-testid="UserAvatar"] img')?.src || '';
        return { name, bio, avatar };
      })()
    `) as { name: string; bio: string; avatar: string };

    // Parse tweets from intercepted API data or fall back to DOM extraction
    let items: Array<{ title: string; description?: string; link: string; pubDate?: string; author: string }> = [];

    if (requests.length > 0) {
      // Parse from API response (more reliable)
      for (const req of requests) {
        try {
          const data = req.body as any;
          const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions
            || data?.data?.user?.result?.timeline?.timeline?.instructions
            || [];

          for (const instruction of instructions) {
            const entries = instruction.entries || [];
            for (const entry of entries) {
              const tweet = entry?.content?.itemContent?.tweet_results?.result;
              if (!tweet?.legacy) continue;

              const legacy = tweet.legacy;
              const author = tweet.core?.user_results?.result?.legacy?.name || username;
              items.push({
                title: (legacy.full_text || '').slice(0, 200),
                description: legacy.full_text || '',
                link: `https://x.com/${username}/status/${legacy.id_str || entry.entryId?.replace('tweet-', '')}`,
                pubDate: legacy.created_at,
                author,
              });
            }
          }
        } catch { /* skip malformed response */ }
      }
    }

    // Fallback: extract from DOM if API interception didn't work
    if (items.length === 0) {
      items = await page.evaluate(`
        (function() {
          const tweets = document.querySelectorAll('[data-testid="tweet"]');
          return Array.from(tweets).slice(0, 20).map(tweet => {
            const textEl = tweet.querySelector('[data-testid="tweetText"]');
            const text = textEl?.textContent || '';
            const timeEl = tweet.querySelector('time');
            const time = timeEl?.getAttribute('datetime') || '';
            const linkEl = tweet.querySelector('a[href*="/status/"]');
            const link = linkEl ? 'https://x.com' + linkEl.getAttribute('href') : '';
            return { title: text.slice(0, 200), description: text, link, pubDate: time, author: '${username}' };
          });
        })()
      `) as typeof items;
    }

    return {
      title: `${userInfo.name} (@${username})`,
      link: `https://x.com/${username}`,
      description: userInfo.bio,
      image: userInfo.avatar,
      item: items.map((t) => ({
        title: t.title,
        description: t.description,
        link: t.link,
        guid: t.link,
        pubDate: t.pubDate ? new Date(t.pubDate) : undefined,
        author: t.author,
      })),
    };
  },
};
