import { logger } from '../logger';

interface AlertPayload {
  incidentId: number; siteId: number; siteName: string; siteUrl: string;
  type: string; reason: string; failureStep?: string;
  screenshotUrl?: string; timestamp: string; dashboardUrl: string;
}

export class SlackSender {
  constructor(private webhookUrl: string) {}

  async send(payload: AlertPayload): Promise<void> {
    const emoji = payload.type === 'transaction_failure' ? '⚡' : '🔗';
    const color = '#EF4444';

    const message = {
      attachments: [{
        color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${emoji} Vigil Alert: ${payload.siteName}` },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Type:* ${payload.type.replace('_', ' ')}` },
              { type: 'mrkdwn', text: `*Site:* <${payload.siteUrl}|${payload.siteUrl}>` },
              { type: 'mrkdwn', text: `*Reason:* ${payload.reason}` },
              ...(payload.failureStep ? [{ type: 'mrkdwn', text: `*Failed Step:* ${payload.failureStep}` }] : []),
              { type: 'mrkdwn', text: `*Time:* ${payload.timestamp}` },
            ],
          },
          {
            type: 'actions',
            elements: [{
              type: 'button',
              text: { type: 'plain_text', text: '🔍 View Incident' },
              url: payload.dashboardUrl,
              style: 'danger',
            }],
          },
        ],
      }],
    };

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
    logger.info(`Slack alert sent for incident ${payload.incidentId}`);
  }
}
