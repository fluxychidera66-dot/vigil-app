/**
 * Transaction executor – replays a recorded flow using Playwright.
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'vigil-failures';
const ALERT_MANAGER_URL = process.env.ALERT_MANAGER_URL || 'http://alert-manager:3012';
const STEP_TIMEOUT = parseInt(process.env.STEP_TIMEOUT_MS || '15000');

interface FlowStep {
  action: string;
  selector?: string;
  value?: string;
  description?: string;
}

export class TransactionExecutor {
  private db: any;
  private metrics: any;

  constructor(db: any, metrics: any) {
    this.db = db;
    this.metrics = metrics;
  }

  async runTransaction(tx: any, region: string) {
    const startTime = Date.now();
    let browser: Browser | null = null;
    let failureStep: string | undefined;
    let failureReason: string | undefined;
    let screenshotFullUrl: string | undefined;
    let screenshotBlurredUrl: string | undefined;
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      // Collect console errors
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      // Collect network failures
      page.on('requestfailed', request => {
        networkErrors.push(`${request.method()} ${request.url()} → ${request.failure()?.errorText}`);
      });
      page.on('response', response => {
        if (response.status() >= 400) {
          networkErrors.push(`${response.request().method()} ${response.url()} → ${response.status()}`);
        }
      });

      // Execute each step
      const steps: FlowStep[] = tx.steps || [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        failureStep = step.description || `${step.action} ${step.selector || step.value || ''}`;

        await this.executeStep(page, step, i);
      }

      // Success
      const duration = Date.now() - startTime;
      await this.db.query(
        `INSERT INTO vigil_transaction_runs (transaction_id, status, duration_ms, region, ran_at)
         VALUES ($1, 'success', $2, $3, NOW())`,
        [tx.id, duration, region]
      );
      this.metrics.runsSucceeded.inc({ transaction_id: tx.id });
      logger.info(`Transaction ${tx.id} "${tx.name}" succeeded in ${duration}ms (${region})`);

    } catch (err: any) {
      const duration = Date.now() - startTime;
      failureReason = err.message || String(err);

      logger.error(`Transaction ${tx.id} "${tx.name}" FAILED at "${failureStep}": ${failureReason}`);
      this.metrics.runsFailed.inc({ transaction_id: tx.id });

      // Capture failure screenshot
      try {
        if (browser) {
          const pages = browser.contexts()[0]?.pages() || [];
          const activePage = pages[pages.length - 1];
          if (activePage) {
            const buf = await activePage.screenshot({ fullPage: true, type: 'png' });
            const filename = `${tx.site_id}/txn-${tx.id}/${Date.now()}-failure.png`;

            const { error: uploadErr } = await supabase.storage
              .from(SUPABASE_BUCKET)
              .upload(filename, buf, { contentType: 'image/png' });

            if (!uploadErr) {
              const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filename);
              screenshotFullUrl = data.publicUrl;
              screenshotBlurredUrl = `${screenshotFullUrl}?width=400&blur=60`;
            }
          }
        }
      } catch (screenshotErr) {
        logger.warn('Failed to capture screenshot:', screenshotErr);
      }

      // Create incident
      const incidentResult = await this.db.query(
        `INSERT INTO vigil_incidents
           (site_id, transaction_id, incident_type, region, failure_step, failure_reason,
            screenshot_full_url, screenshot_blurred_url, console_logs, network_errors, created_at)
         VALUES ($1, $2, 'transaction_failure', $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id`,
        [
          tx.site_id, tx.id, region, failureStep, failureReason,
          screenshotFullUrl, screenshotBlurredUrl,
          JSON.stringify(consoleErrors), JSON.stringify(networkErrors),
        ]
      );

      await this.db.query(
        `INSERT INTO vigil_transaction_runs (transaction_id, status, duration_ms, failure_step, failure_reason, incident_id, region, ran_at)
         VALUES ($1, 'failure', $2, $3, $4, $5, $6, NOW())`,
        [tx.id, duration, failureStep, failureReason, incidentResult.rows[0].id, region]
      );

      // Notify alert manager
      await fetch(`${ALERT_MANAGER_URL}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: incidentResult.rows[0].id,
          siteId: tx.site_id,
          transactionId: tx.id,
          type: 'transaction_failure',
          reason: failureReason,
          failureStep,
          screenshotUrl: screenshotBlurredUrl,
          consoleErrors,
          networkErrors,
        }),
      }).catch(err => logger.error('Alert manager notification failed:', err));

    } finally {
      if (browser) await browser.close();
    }
  }

  private async executeStep(page: Page, step: FlowStep, index: number): Promise<void> {
    const { action, selector, value } = step;

    switch (action) {
      case 'navigate':
        await page.goto(value!, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
        break;

      case 'click':
        await page.waitForSelector(selector!, { timeout: STEP_TIMEOUT });
        await page.click(selector!);
        break;

      case 'fill':
        await page.waitForSelector(selector!, { timeout: STEP_TIMEOUT });
        // Use placeholder data to avoid storing real PII
        const safeValue = this.sanitizeInput(value || '');
        await page.fill(selector!, safeValue);
        break;

      case 'assert':
        const element = await page.waitForSelector(selector!, { timeout: STEP_TIMEOUT });
        if (!element) throw new Error(`Assertion failed: ${selector} not visible`);
        break;

      case 'wait':
        await page.waitForTimeout(parseInt(value || '1000'));
        break;

      case 'screenshot':
        // Just take a screenshot without storing (for debugging during development)
        await page.screenshot();
        break;

      default:
        logger.warn(`Unknown step action: ${action}`);
    }
  }

  private sanitizeInput(value: string): string {
    // Replace real-looking emails with placeholder
    if (value.includes('@') && value.includes('.')) return 'test@example.com';
    // Replace card numbers
    if (/\d{4}[\s-]?\d{4}/.test(value)) return '4242 4242 4242 4242';
    return value;
  }
}
