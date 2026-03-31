/**
 * Vigil Transaction Runner
 * Reads recorded flows from DB and replays them with Playwright.
 * Runs failed checks → creates incidents → notifies alert manager.
 */

import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import express from 'express';
import { db } from './db';
import { TransactionExecutor } from './executor';
import { metrics } from './metrics';
import { logger } from './logger';

const PORT = process.env.PORT || 3011;

// ─── Scheduler ─────────────────────────────────────────────────────────────
async function runDueTransactions() {
  try {
    const result = await db.query(
      `SELECT t.*, s.url as site_url, s.config as site_config
       FROM vigil_transactions t
       JOIN vigil_sites s ON s.id = t.site_id
       WHERE t.active = TRUE`
    );

    logger.info(`Running ${result.rows.length} active transaction(s)`);

    await Promise.allSettled(
      result.rows.map(async (tx) => {
        const executor = new TransactionExecutor(db, metrics);
        for (const region of (tx.regions || ['us-east-1'])) {
          await executor.runTransaction(tx, region);
        }
      })
    );
  } catch (err) {
    logger.error('Transaction run failed:', err);
    metrics.runsErrored.inc();
  }
}

// Run every minute and check if transactions are due
cron.schedule('* * * * *', runDueTransactions);

// ─── HTTP server ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'vigil-transaction-runner' }));
app.get('/metrics', async (_, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// Manual trigger endpoint (for testing)
app.post('/run/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const result = await db.query(
      `SELECT t.*, s.url as site_url FROM vigil_transactions t
       JOIN vigil_sites s ON s.id = t.site_id WHERE t.id = $1`,
      [transactionId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    const executor = new TransactionExecutor(db, metrics);
    await executor.runTransaction(result.rows[0], 'us-east-1');
    res.json({ status: 'completed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  logger.info(`Vigil Transaction Runner running on port ${PORT}`);
});
