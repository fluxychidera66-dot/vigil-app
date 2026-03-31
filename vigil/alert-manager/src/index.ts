/**
 * Vigil Alert Manager
 * Receives incident events from crawler/transaction-runner
 * and sends alerts via Slack, email, or webhooks.
 * Optionally forwards to Keep (open-source alerting engine).
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { db } from './db';
import { SlackSender } from './senders/slack';
import { EmailSender } from './senders/email';
import { WebhookSender } from './senders/webhook';
import { KeepSender } from './senders/keep';
import { logger } from './logger';
import { metrics } from './metrics';

const PORT = process.env.PORT || 3012;
const app = express();
app.use(express.json());

// ─── Incident handler ────────────────────────────────────────────────────────
app.post('/incidents', async (req, res) => {
  const incident = req.body;
  logger.info(`Received incident: ${JSON.stringify(incident)}`);
  metrics.incidentsReceived.inc({ type: incident.type || 'unknown' });

  try {
    // Get site config to know which channels to alert
    const siteResult = await db.query(
      'SELECT * FROM vigil_sites WHERE id = $1',
      [incident.siteId]
    );

    if (!siteResult.rows.length) {
      logger.warn(`Site ${incident.siteId} not found`);
      return res.status(404).json({ error: 'Site not found' });
    }

    const site = siteResult.rows[0];
    const config = site.config || {};
    const alertChannels = config.alert_channels || [];

    const payload = {
      incidentId:   incident.incidentId,
      siteId:       incident.siteId,
      siteName:     site.name,
      siteUrl:      site.url,
      type:         incident.type,
      reason:       incident.reason,
      failureStep:  incident.failureStep,
      screenshotUrl:incident.screenshotUrl,
      timestamp:    new Date().toISOString(),
      dashboardUrl: `${process.env.DASHBOARD_URL || 'http://localhost:3000'}/vigil/incidents`,
    };

    const senders = [];

    // Slack
    if (config.slack_webhook || process.env.SLACK_WEBHOOK_URL) {
      senders.push(new SlackSender(config.slack_webhook || process.env.SLACK_WEBHOOK_URL));
    }

    // Email
    if (config.alert_email || process.env.ALERT_EMAIL) {
      senders.push(new EmailSender(config.alert_email || process.env.ALERT_EMAIL));
    }

    // Generic webhook
    if (config.webhook_url) {
      senders.push(new WebhookSender(config.webhook_url));
    }

    // Keep (if configured)
    if (process.env.KEEP_WEBHOOK_URL) {
      senders.push(new KeepSender(process.env.KEEP_WEBHOOK_URL));
    }

    // Send all alerts in parallel
    const results = await Promise.allSettled(
      senders.map(sender => sender.send(payload))
    );

    // Record alerts in DB
    for (const result of results) {
      const channel = result.status === 'fulfilled' ? 'sent' : 'failed';
      await db.query(
        `INSERT INTO vigil_alerts (incident_id, channel, status, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [incident.incidentId, channel, result.status === 'fulfilled' ? 'sent' : 'failed']
      );
      if (result.status === 'fulfilled') metrics.alertsSent.inc();
      else metrics.alertsFailed.inc();
    }

    res.json({ status: 'alerts_sent', count: senders.length });

  } catch (err: any) {
    logger.error('Alert handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'vigil-alert-manager' }));
app.get('/metrics', async (_, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.listen(PORT, () => logger.info(`Vigil Alert Manager running on port ${PORT}`));
