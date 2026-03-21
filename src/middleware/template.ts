import type { Context, Next } from 'hono';
import type { Data } from '../types.js';
import { renderRSS } from '../views/rss.js';

export async function templateMiddleware(ctx: Context, next: Next) {
  await next();

  const data = ctx.get('data') as Data | undefined;
  if (!data) return;

  // Sort items by pubDate descending
  if (data.item) {
    data.item.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }

  const format = ctx.req.query('format') || 'rss';
  const selfLink = ctx.req.url;

  let body: string;
  let contentType: string;

  switch (format) {
    case 'json': {
      contentType = 'application/json; charset=utf-8';
      body = JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: data.title,
        home_page_url: data.link,
        description: data.description,
        items: (data.item || []).map((item) => ({
          id: item.guid || item.link,
          url: item.link,
          title: item.title,
          content_html: item.description,
          date_published: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
          authors: item.author ? [{ name: item.author }] : undefined,
          tags: item.category,
        })),
      }, null, 2);
      break;
    }
    default: {
      contentType = 'application/xml; charset=utf-8';
      body = renderRSS(data, selfLink);
      break;
    }
  }

  ctx.set('rssBody', body);
  ctx.header('Content-Type', contentType);
  return ctx.body(body);
}
