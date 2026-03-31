import * as promClient from 'prom-client';
export const metrics = {
  register: promClient.register,
  incidentsReceived: new promClient.Counter({ name: 'vigil_incidents_received_total', help: 'Incidents received by alert manager', labelNames: ['type'] }),
  alertsSent: new promClient.Counter({ name: 'vigil_alerts_sent_total', help: 'Alerts sent successfully' }),
  alertsFailed: new promClient.Counter({ name: 'vigil_alerts_failed_total', help: 'Alerts that failed to send' }),
};
