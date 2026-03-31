import * as promClient from 'prom-client';

export const metrics = {
  register: promClient.register,
  crawlsCompleted: new promClient.Counter({
    name: 'vigil_crawls_completed_total',
    help: 'Total number of crawls completed',
  }),
  crawlsFailed: new promClient.Counter({
    name: 'vigil_crawls_failed_total',
    help: 'Total number of crawls failed',
  }),
  incidentsCreated: new promClient.Counter({
    name: 'vigil_incidents_created_total',
    help: 'Total number of incidents created',
    labelNames: ['type'],
  }),
  pageCheckDuration: new promClient.Histogram({
    name: 'vigil_page_check_duration_ms',
    help: 'Duration of page checks in milliseconds',
    buckets: [100, 500, 1000, 2000, 5000, 10000],
  }),
};
