import express, { type Express, type Request, type Response } from 'express';
import { config } from './envConfig.ts';
import { errorHandler } from './errorHandler.ts';
import { httpLogger, logger } from './logger.ts';
import { router as notificationsApiRouter } from './api/notifications.ts';
import { pool } from './db.ts';

const app: Express = express();

app.use(httpLogger);
app.use(express.json());

app.use('/notifications', notificationsApiRouter);

app.get('/', (_req: Request, res: Response) => {
  res.send('Hello World');
});

app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    logger.error({ err }, 'Health Check Failed');
    res.status(503).json({ status: 'error' });
  }
});

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  logger.info(`listening on port ${config.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  // Force exit if open keep-alive connections stop the server closing.
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
