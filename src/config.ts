const env = process.env;

export const config = {
  port: parseInt(env.PORT || '3000', 10),
  cacheExpire: parseInt(env.CACHE_EXPIRE || '300', 10),
  cacheMax: parseInt(env.CACHE_MAX || '256', 10),
  logLevel: env.LOG_LEVEL || 'info',
  proxyUri: env.PROXY_URI || '',
  feedsDir: env.FEEDS_DIR || './feeds',
};
