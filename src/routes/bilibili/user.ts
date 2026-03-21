import type { Route } from '../../types.js';

export const route: Route = {
  path: '/user/:uid',
  name: 'User Videos',
  example: '/bilibili/user/2267573',
  strategy: 'cookie', // Uses browser cookies for anti-scraping bypass
  parameters: {
    uid: 'Bilibili user UID',
  },

  handler: async (ctx, page) => {
    if (!page) throw new Error('Browser page required');

    const uid = ctx.req.param('uid');

    // Navigate to user's video page — reuses browser's bilibili login session
    await page.goto(`https://space.bilibili.com/${uid}/video`);
    await page.evaluate('new Promise(r => setTimeout(r, 3000))');

    // Extract user info and videos from the page
    const data = await page.evaluate(`
      (function() {
        const name = document.querySelector('.nickname')?.textContent?.trim()
          || document.querySelector('#h-name')?.textContent?.trim()
          || 'Unknown';
        const avatar = document.querySelector('.bili-avatar img')?.src
          || document.querySelector('#h-avatar')?.src
          || '';
        const sign = document.querySelector('.h-sign')?.textContent?.trim() || '';

        // Try new layout
        let videos = Array.from(document.querySelectorAll('.small-item, .video-card')).map(el => {
          const link = el.querySelector('a[href*="/video/"]');
          const href = link?.getAttribute('href') || '';
          const title = el.querySelector('.title')?.textContent?.trim()
            || link?.getAttribute('title')
            || '';
          const cover = el.querySelector('img')?.src || '';
          const duration = el.querySelector('.duration')?.textContent?.trim() || '';
          const plays = el.querySelector('.play-text')?.textContent?.trim() || '';
          const date = el.querySelector('.time')?.textContent?.trim() || '';
          return {
            title,
            link: href.startsWith('//') ? 'https:' + href : href.startsWith('/') ? 'https://www.bilibili.com' + href : href,
            cover,
            duration,
            plays,
            date,
          };
        }).filter(v => v.title && v.link);

        return { name, avatar, sign, videos };
      })()
    `) as {
      name: string;
      avatar: string;
      sign: string;
      videos: Array<{
        title: string;
        link: string;
        cover: string;
        duration: string;
        plays: string;
        date: string;
      }>;
    };

    return {
      title: `${data.name} - Bilibili`,
      link: `https://space.bilibili.com/${uid}`,
      description: data.sign,
      image: data.avatar,
      item: data.videos.map((v) => ({
        title: v.title,
        description: `${v.title}${v.duration ? ` (${v.duration})` : ''}${v.plays ? ` - ${v.plays} plays` : ''}${v.cover ? `<br/><img src="${v.cover}" referrerpolicy="no-referrer"/>` : ''}`,
        link: v.link,
        guid: v.link,
        author: data.name,
      })),
    };
  },
};
