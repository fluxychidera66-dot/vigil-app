import { logger } from '../logger';

export class WebhookSender {
  constructor(private url: string) {}

  async send(payload: any): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vigil-Event': 'incident' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Webhook failed: ${res.status}`);
    logger.info(`Webhook sent to ${this.url} for incident ${payload.incidentId}`);
  }
}
