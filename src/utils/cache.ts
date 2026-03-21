import { LRUCache } from 'lru-cache';
import { config } from '../config.js';

const store = new LRUCache<string, string>({
  max: config.cacheMax,
  ttl: config.cacheExpire * 1000,
});

export const cache = {
  get(key: string): string | undefined {
    return store.get(key);
  },

  set(key: string, value: string, ttl?: number): void {
    store.set(key, value, { ttl: ttl ? ttl * 1000 : undefined });
  },

  has(key: string): boolean {
    return store.has(key);
  },

  async tryGet<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = store.get(key);
    if (cached) return JSON.parse(cached);
    const value = await fn();
    store.set(key, JSON.stringify(value), { ttl: ttl ? ttl * 1000 : undefined });
    return value;
  },
};
