import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { authHandler } from '../auth.js';
import api from '../routes/index.js';
import { notFound, errorHandler } from '../middleware/error.middleware.js';
import { env } from './env.js';

// Behind the Vercel proxy the Host header is the Render host; Auth.js builds callback/redirect URLs from it.
// Force the public (Vercel) host so Google gets https://<vercel-host>/auth/callback/google.
const publicHost = (() => {
  try {
    return env.prod && process.env.WEB_URL ? new URL(process.env.WEB_URL).host : null;
  } catch {
    return null;
  }
})();

export function createApp() {
  const app = express();
  app.set('trust proxy', env.trustProxy);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  app.use(cors({ origin: env.webOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(morgan('dev'));

  app.use('/auth', (req, _res, next) => {
    if (publicHost) req.headers.host = publicHost;
    next();
  });
  app.use('/auth', rateLimit({ windowMs: 900000, limit: 100 }));
  app.use('/auth/', authHandler);

  app.get('/health', (_q, s) => s.json({ status: 'ok', service: 'tendrils-api', time: new Date().toISOString() }));

  // Generous for reads (one page load is ~10 calls and offices share an IP); stricter for writes.
  const writes = rateLimit({
    windowMs: 60000,
    limit: 240,
    skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.path.startsWith('/dev/'),
  });
  app.use('/api/v1', rateLimit({ windowMs: 60000, limit: 1200 }), writes, api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}