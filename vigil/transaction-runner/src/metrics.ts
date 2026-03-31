import * as promClient from 'prom-client';
export const metrics = {
  register: promClient.register,
  runsSucceeded: new promClient.Counter({ name: 'vigil_transaction_runs_succeeded_total', help: 'Successful transaction runs', labelNames: ['transaction_id'] }),
  runsFailed: new promClient.Counter({ name: 'vigil_transaction_runs_failed_total', help: 'Failed transaction runs', labelNames: ['transaction_id'] }),
  runsErrored: new promClient.Counter({ name: 'vigil_transaction_runner_errors_total', help: 'Internal errors' }),
};
