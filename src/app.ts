import express, { type Express, type Request, type Response } from 'express';
import { config } from './config.ts';
import { errorHandler } from './errorHandler.ts';
import { httpLogger, logger } from './logger.ts';

const app: Express = express();

app.use(httpLogger);

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World');
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use(errorHandler);

app.listen(config.PORT, () => {
  logger.info(`listening on port ${config.PORT}`);
});
