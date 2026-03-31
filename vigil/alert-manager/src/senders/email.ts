import nodemailer from 'nodemailer';
import { logger } from '../logger';

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export class EmailSender {
  constructor(private to: string) {}

  async send(payload: any): Promise<void> {
    const subject = `⚠️ Vigil Alert: ${payload.type.replace('_', ' ')} on ${payload.siteName}`;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A0A0F;color:#fff;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#6366F1,#A855F7);padding:24px">
          <h1 style="margin:0;font-size:20px">⚠️ Vigil Alert</h1>
          <p style="margin:4px 0 0;opacity:0.85">${payload.siteName}</p>
        </div>
        <div style="padding:24px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#A0A0B8;width:120px">Type</td><td style="padding:8px 0;color:#fff;font-weight:600">${payload.type.replace('_',' ')}</td></tr>
            <tr><td style="padding:8px 0;color:#A0A0B8">Site</td><td style="padding:8px 0"><a href="${payload.siteUrl}" style="color:#818CF8">${payload.siteUrl}</a></td></tr>
            <tr><td style="padding:8px 0;color:#A0A0B8">Reason</td><td style="padding:8px 0;color:#EF4444">${payload.reason}</td></tr>
            ${payload.failureStep ? `<tr><td style="padding:8px 0;color:#A0A0B8">Failed Step</td><td style="padding:8px 0;color:#fff">${payload.failureStep}</td></tr>` : ''}
            <tr><td style="padding:8px 0;color:#A0A0B8">Time</td><td style="padding:8px 0;color:#fff">${payload.timestamp}</td></tr>
          </table>
          <div style="margin-top:24px">
            <a href="${payload.dashboardUrl}" style="background:linear-gradient(135deg,#6366F1,#A855F7);color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">View Incident in Vigil →</a>
          </div>
          ${payload.screenshotUrl ? `<div style="margin-top:20px"><p style="color:#A0A0B8;font-size:12px;margin:0 0 8px">Failure Screenshot (blurred – upgrade to Pro for full view)</p><img src="${payload.screenshotUrl}" style="width:100%;border-radius:8px;filter:blur(6px)" /></div>` : ''}
        </div>
        <div style="padding:16px 24px;background:#12121A;color:#5A5A70;font-size:12px">
          Vigil · Revenue Protection Monitoring · <a href="${payload.dashboardUrl}" style="color:#6366F1">Manage alerts</a>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'Vigil Alerts <alerts@yourvigilapp.com>',
      to: this.to, subject, html,
    });

    logger.info(`Email alert sent to ${this.to} for incident ${payload.incidentId}`);
  }
}
