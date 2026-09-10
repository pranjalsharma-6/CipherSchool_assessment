import express, { type Express } from 'express';
import cors from 'cors';
import type { Container } from './container.js';
import { createRoutes } from './infrastructure/http/routes.js';
import { errorHandler, notFoundHandler } from './infrastructure/http/errorHandler.js';

export function createApp(container: Container): Express {
  const app = express();

  app.use(cors({ origin: container.config.CORS_ORIGIN }));
  // Code submissions are the largest payload the API takes.
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createRoutes(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
