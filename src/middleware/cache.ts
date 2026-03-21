import type { Context, Next } from 'hono';
import { cache } from '../utils/cache.js';
import { config } from '../config.js';

export async function cacheMiddleware(ctx: Context, next: Next) {
  const key = `route:${ctx.req.url}`;
  const cached = cache.get(key);

  if (cached) {
    ctx.header('X-OpenRSS-Cache', 'HIT');
    ctx.header('Content-Type', 'application/xml; charset=utf-8');
    return ctx.body(cached);
  }

  await next();

  // Cache the response body if it was set
  const body = ctx.get('rssBody') as string | undefined;
  if (body) {
    cache.set(key, body, config.cacheExpire);
    ctx.header('X-OpenRSS-Cache', 'MISS');
  }
}
