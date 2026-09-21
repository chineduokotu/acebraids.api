/**
 * Structured logger — zero extra dependencies.
 *
 * Production (NODE_ENV=production): one JSON line per entry, suitable for
 * Render's log stream, Datadog, Logtail, etc.
 *
 * Development: coloured human-readable lines via console methods.
 */
const isProd = process.env.NODE_ENV === 'production';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// Only emit entries at or below this level.
const MAX_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? (isProd ? LEVELS.info : LEVELS.debug);

const emit = (level, message, meta) => {
  if (LEVELS[level] > MAX_LEVEL) return;

  if (isProd) {
    // Machine-readable JSON line — never pretty-printed so it stays one line.
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(meta && Object.keys(meta).length ? { meta } : {}),
      }) + '\n',
    );
  } else {
    const ts = new Date().toISOString();
    const COLOR = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
    const RESET = '\x1b[0m';
    const prefix = `${COLOR[level]}[${level.toUpperCase()}]${RESET} ${ts}`;
    const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](`${prefix} ${message}${metaStr}`);
  }
};

export const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn:  (message, meta) => emit('warn',  message, meta),
  info:  (message, meta) => emit('info',  message, meta),
  debug: (message, meta) => emit('debug', message, meta),
};
