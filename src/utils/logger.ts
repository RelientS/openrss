const levels = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof levels;

const current = (process.env.LOG_LEVEL as Level) || 'info';

function log(level: Level, ...args: unknown[]) {
  if (levels[level] <= levels[current]) {
    const ts = new Date().toISOString();
    // Always write to stderr so CLI stdout stays clean JSON
    process.stderr.write(`[${ts}] [${level.toUpperCase()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`);
  }
}

export const logger = {
  error: (...args: unknown[]) => log('error', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  debug: (...args: unknown[]) => log('debug', ...args),
};
