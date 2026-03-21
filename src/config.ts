const env = process.env;

export const config = {
  port: parseInt(env.PORT || '3000', 10),
  daemonPort: parseInt(env.DAEMON_PORT || '19826', 10),
  cacheExpire: parseInt(env.CACHE_EXPIRE || '300', 10),
  cacheMax: parseInt(env.CACHE_MAX || '256', 10),
  logLevel: env.LOG_LEVEL || 'info',
  /** Proxy URI for routes with strategy 'public' (e.g. socks5://127.0.0.1:1080) */
  proxyUri: env.PROXY_URI || '',
};
