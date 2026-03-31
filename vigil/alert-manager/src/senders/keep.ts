/**
 * Keep (https://keephq.dev) integration.
 * Keep is an open-source alert management platform with Slack/email routing.
 */
import { logger } from '../logger';

export class KeepSender {
  constructor(private keepWebhookUrl: string) {}

  async send(payload: any): Promise<void> {
    const keepPayload = {
      name:     `Vigil: ${payload.type} on ${payload.siteName}`,
      message:  payload.reason,
      severity: 'critical',
      source:   ['vigil'],
      labels: {
        site:   payload.siteName,
        url:    payload.siteUrl,
        region: payload.region || 'unknown',
        type:   payload.type,
      },
      url:      payload.dashboardUrl,
    };

    const res = await fetch(this.keepWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.KEEP_API_KEY || '' },
      body: JSON.stringify(keepPayload),
    });
    if (!res.ok) throw new Error(`Keep webhook failed: ${res.status}`);
    logger.info(`Keep alert sent for incident ${payload.incidentId}`);
  }
}
