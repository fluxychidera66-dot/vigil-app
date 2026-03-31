import { Router } from 'express';
import { db } from '../db';
import { AuthRequest } from '../middleware/auth';

export const flowsRouter = Router();

flowsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT t.*, s.name as site_name, s.url as site_url,
        (SELECT ran_at FROM vigil_transaction_runs r WHERE r.transaction_id = t.id ORDER BY ran_at DESC LIMIT 1) as last_run,
        (SELECT status FROM vigil_transaction_runs r WHERE r.transaction_id = t.id ORDER BY ran_at DESC LIMIT 1) as last_status
       FROM vigil_transactions t
       JOIN vigil_sites s ON s.id = t.site_id
       WHERE s.config->>'user_id' = $1
       ORDER BY t.created_at DESC`,
      [String(req.userId)]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

flowsRouter.post('/', async (req: AuthRequest, res) => {
  const { siteId, name, steps, schedule, regions } = req.body;
  if (!siteId || !name || !steps) return res.status(400).json({ error: 'siteId, name, steps required' });
  try {
    const result = await db.query(
      `INSERT INTO vigil_transactions (site_id, name, steps, schedule, regions, active, created_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NOW()) RETURNING *`,
      [siteId, name, JSON.stringify(steps), schedule || '*/15 * * * *', regions || ['us-east-1']]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

flowsRouter.patch('/:id', async (req, res) => {
  const { active, schedule, regions, steps } = req.body;
  try {
    const result = await db.query(
      `UPDATE vigil_transactions SET
        active   = COALESCE($1, active),
        schedule = COALESCE($2, schedule),
        regions  = COALESCE($3, regions),
        steps    = COALESCE($4, steps),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [active, schedule, regions, steps ? JSON.stringify(steps) : null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

flowsRouter.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM vigil_transactions WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});
