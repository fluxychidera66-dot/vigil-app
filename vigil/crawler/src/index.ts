/**
 * Vigil Crawler Service
 * Uses Crawlee + Playwright to discover and monitor website pages.
 * Runs as a BullMQ worker, processing crawl jobs from a Redis queue.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { Queue, Worker } from 'bullmq';
import { db } from './db';
import { CrawlerWorker } from './crawler';
import { metrics } from './metrics';
import { logger } from './logger';

const PORT = process.env.PORT || 3010;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Redis connection config
const redisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// ─── Queues ────────────────────────────────────────────────────────────────
export const crawlQueue = new Queue('vigil:crawl', { connection: redisConnection });
export const pageCheckQueue = new Queue('vigil:page-check', { connection: redisConnection });

// ─── Workers ───────────────────────────────────────────────────────────────
const crawlWorker = new Worker(
  'vigil:crawl',
  async (job) => {
    const { siteId, url, config } = job.data;
    logger.info(`Starting crawl for site ${siteId}: ${url}`);
    const worker = new CrawlerWorker(db, metrics);
    await worker.crawlSite(siteId, url, config);
    metrics.crawlsCompleted.inc();
  },
  { connection: redisConnection, concurrency: 3 }
);

const pageCheckWorker = new Worker(
  'vigil:page-check',
  async (job) => {
    const { siteId, url, isCritical } = job.data;
    const worker = new CrawlerWorker(db, metrics);
    await worker.checkPage(siteId, url, isCritical);
  },
  { connection: redisConnection, concurrency: 10 }
);

// ─── Scheduler ─────────────────────────────────────────────────────────────
async function scheduleChecks() {
  try {
    const sites = await db.query(
      "SELECT * FROM vigil_sites WHERE config->>'disabled' IS DISTINCT FROM 'true'"
    );
    for (const site of sites.rows) {
      const config = site.config || {};
      const interval = config.check_interval || 15;  // minutes
      await pageCheckQueue.add(
        `check:${site.id}`,
        { siteId: site.id, url: site.url, isCritical: false },
        { repeat: { every: interval * 60 * 1000 } }
      );
      // Schedule critical pages more frequently
      if (config.critical_pages?.length) {
        for (const page of config.critical_pages) {
          await pageCheckQueue.add(
            `critical:${site.id}:${page}`,
            { siteId: site.id, url: site.url + page, isCritical: true },
            { repeat: { every: 5 * 60 * 1000 } }
          );
        }
      }
    }
    logger.info(`Scheduled checks for ${sites.rows.length} sites`);
  } catch (err) {
    logger.error('Failed to schedule checks:', err);
  }
}

// ─── HTTP server (metrics + health) ────────────────────────────────────────
const app = express();

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'vigil-crawler' }));
app.get('/metrics', async (_, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.listen(PORT, () => {
  logger.info(`Vigil Crawler running on port ${PORT}`);
  scheduleChecks();
  // Re-schedule every hour to pick up new sites
  setInterval(scheduleChecks, 60 * 60 * 1000);
});

// Error handling
crawlWorker.on('failed', (job, err) => {
  logger.error(`Crawl job ${job?.id} failed:`, err);
  metrics.crawlsFailed.inc();
});
pageCheckWorker.on('failed', (job, err) => {
  logger.error(`Page check job ${job?.id} failed:`, err);
});
