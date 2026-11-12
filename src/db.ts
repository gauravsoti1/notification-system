import pg from 'pg';
import { config } from './config.ts';
import { logger } from './logger.ts';

// One pool for the whole app. Modules are evaluated once, so every import shares this instance.
// The pool connects lazily on the first query, so importing it never fails if Postgres is down.
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
});

// An idle connection can error (e.g. Postgres restarts). Without a listener this crashes the process.
pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));
