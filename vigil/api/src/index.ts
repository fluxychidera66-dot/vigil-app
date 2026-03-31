/**
 * Vigil API Server
 * Provides REST endpoints for Sites, Flows, Incidents, and Subscriptions.
 * Integrates with OpenReplay's JWT authentication.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { db } from './db';
import { sitesRouter } from './routes/sites';
import { flowsRouter } from './routes/flows';
import { incidentsRouter } from './routes/incidents';
import { subscriptionsRouter } from './routes/subscriptions';
import { stripeWebhookRouter } from './routes/stripe-webhook';
import { authMiddleware } from './middleware/auth';
import { logger } from './logger';

const PORT = process.env.VIGIL_API_PORT || 3013;
const app = express();

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));

// Stripe webhook needs raw body
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

app.use(express.json());

// ─── Public routes ──────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'vigil-api', version: '1.0.0' }));

// ─── Protected routes (require JWT from OpenReplay) ──────────────────────────
app.use('/api/vigil', authMiddleware);
app.use('/api/vigil/sites', sitesRouter);
app.use('/api/vigil/flows', flowsRouter);
app.use('/api/vigil/incidents', incidentsRouter);
app.use('/api/vigil/subscriptions', subscriptionsRouter);

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => logger.info(`Vigil API running on port ${PORT}`));
