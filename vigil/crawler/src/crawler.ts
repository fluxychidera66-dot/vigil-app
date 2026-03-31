/**
 * Core crawling logic using Crawlee + Playwright.
 */

import { PlaywrightCrawler, Configuration } from 'crawlee';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { logger } from './logger';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'vigil-failures';
const CONSECUTIVE_FAILURES = parseInt(process.env.ALERT_THRESHOLD || '2');

export class CrawlerWorker {
  private db: any;
  private metrics: any;
  private failureCounters: Map<string, number> = new Map();

  constructor(db: any, metrics: any) {
    this.db = db;
    this.metrics = metrics;
  }

  /**
   * Full site crawl: discover all pages, check each for errors.
   */
  async crawlSite(siteId: number, startUrl: string, config: any = {}) {
    const discoveredUrls: string[] = [];
    const baseUrl = new URL(startUrl).origin;

    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: config.max_pages || 100,
      maxConcurrency: 3,

      async requestHandler({ page, request, enqueueLinks }) {
        const url = request.url;
        const startTime = Date.now();

        try {
          const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          const statusCode = response?.status() || 0;
          const loadTime = Date.now() - startTime;

          // Record page check
          await this.db.query(
            `INSERT INTO vigil_page_checks (site_id, url, status_code, load_time_ms, checked_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [siteId, url, statusCode, loadTime]
          );

          // Check for failures
          if (statusCode >= 400) {
            await this.handlePageFailure(siteId, url, statusCode, `HTTP ${statusCode}`, page);
          }

          discoveredUrls.push(url);

          // Follow internal links
          await enqueueLinks({
            strategy: 'same-domain',
            baseUrl,
          });
        } catch (err: any) {
          await this.handlePageFailure(siteId, url, 0, err.message, page);
        }
      },
    });

    await crawler.run([startUrl]);
    logger.info(`Crawl complete for site ${siteId}: ${discoveredUrls.length} pages found`);
    return discoveredUrls;
  }

  /**
   * Single page check for scheduled monitoring.
   */
  async checkPage(siteId: number, url: string, isCritical: boolean) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const startTime = Date.now();

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const statusCode = response?.status() || 0;
      const loadTime = Date.now() - startTime;

      await this.db.query(
        `INSERT INTO vigil_page_checks (site_id, url, status_code, load_time_ms, checked_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [siteId, url, statusCode, loadTime]
      );

      if (statusCode >= 400) {
        await this.handlePageFailure(siteId, url, statusCode, `HTTP ${statusCode}`, page);
      }

      // Reset failure counter on success
      this.failureCounters.set(url, 0);

    } catch (err: any) {
      await this.handlePageFailure(siteId, url, 0, err.message, page);
    } finally {
      await browser.close();
    }
  }

  private async handlePageFailure(
    siteId: number, url: string, statusCode: number,
    reason: string, page: any
  ) {
    const key = `${siteId}:${url}`;
    const count = (this.failureCounters.get(key) || 0) + 1;
    this.failureCounters.set(key, count);

    logger.warn(`Page failure #${count} for ${url}: ${reason}`);

    // Only alert after CONSECUTIVE_FAILURES to reduce false positives
    if (count >= CONSECUTIVE_FAILURES) {
      let screenshotUrl: string | undefined;
      let blurredUrl: string | undefined;

      try {
        const screenshotBuffer = await page.screenshot({ fullPage: true });
        const filename = `${siteId}/${Date.now()}-page-failure.png`;

        const { data, error } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(filename, screenshotBuffer, { contentType: 'image/png' });

        if (!error) {
          const { data: urlData } = supabase.storage
            .from(SUPABASE_BUCKET)
            .getPublicUrl(filename);
          screenshotUrl = urlData.publicUrl;
          // Blurred teaser: append transformation params
          blurredUrl = `${screenshotUrl}?width=400&blur=50`;
        }
      } catch (err) {
        logger.error('Failed to upload screenshot:', err);
      }

      // Create incident record
      const result = await this.db.query(
        `INSERT INTO vigil_incidents
          (site_id, incident_type, failure_reason, screenshot_full_url, screenshot_blurred_url, created_at)
         VALUES ($1, 'page_failure', $2, $3, $4, NOW())
         RETURNING id`,
        [siteId, reason, screenshotUrl, blurredUrl]
      );

      // Notify alert manager
      const incidentId = result.rows[0].id;
      await this.notifyAlertManager(incidentId, siteId, url, reason, blurredUrl);

      // Reset counter after alerting
      this.failureCounters.set(key, 0);
    }
  }

  private async notifyAlertManager(
    incidentId: number, siteId: number, url: string,
    reason: string, screenshotUrl?: string
  ) {
    const ALERT_MANAGER_URL = process.env.ALERT_MANAGER_URL || 'http://alert-manager:3012';
    try {
      const response = await fetch(`${ALERT_MANAGER_URL}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId, siteId, type: 'page_failure',
          url, reason, screenshotUrl,
        }),
      });
      if (!response.ok) logger.error(`Alert manager responded: ${response.status}`);
    } catch (err) {
      logger.error('Failed to notify alert manager:', err);
    }
  }
}
