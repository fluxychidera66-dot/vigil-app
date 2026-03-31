import { Router } from 'express';
import { db } from '../db';
import { AuthRequest, tierMiddleware } from '../middleware/auth';

export const incidentsRouter = Router();

incidentsRouter.get('/', async (req: AuthRequest, res) => {
  const { siteId, resolved, limit = 50, offset = 0 } = req.query;
  try {
    const params: any[] = [String(req.userId)];
    let where = "WHERE s.config->>'user_id' = $1";
    if (siteId) { params.push(siteId); where += ` AND i.site_id = $${params.length}`; }
    if (resolved === 'false') where += ' AND i.resolved_at IS NULL';
    if (resolved === 'true') where += ' AND i.resolved_at IS NOT NULL';

    const result = await db.query(
      `SELECT i.*, s.name as site_name, s.url as site_url, t.name as transaction_name
       FROM vigil_incidents i
       JOIN vigil_sites s ON s.id = i.site_id
       LEFT JOIN vigil_transactions t ON t.id = i.transaction_id
       ${where}
       ORDER BY i.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Full screenshot only for Pro users
incidentsRouter.get('/:id/full', tierMiddleware('pro'), async (req, res) => {
  const result = await db.query('SELECT screenshot_full_url FROM vigil_incidents WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ url: result.rows[0].screenshot_full_url });
});

// Mark as resolved
incidentsRouter.post('/:id/resolve', async (req, res) => {
  const result = await db.query(
    'UPDATE vigil_incidents SET resolved_at = NOW() WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  res.json(result.rows[0]);
});
