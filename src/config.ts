const env = process.env;

export const config = {
  port: parseInt(env.PORT || '3000', 10),
  daemonPort: parseInt(env.DAEMON_PORT || '19826', 10),
  cacheExpire: parseInt(env.CACHE_EXPIRE || '300', 10),
  cacheMax: parseInt(env.CACHE_MAX || '256', 10),
  logLevel: env.LOG_LEVEL || 'info',
  proxyUri: env.PROXY_URI || '',

  /** LLM config — any OpenAI-compatible API */
  llm: {
    baseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.LLM_API_KEY || '',
    model: env.LLM_MODEL || 'gpt-4o-mini',
  },
};
