import { Router } from 'express';
import { db } from '../db';
import { AuthRequest } from '../middleware/auth';

export const sitesRouter = Router();

// GET /api/vigil/sites – list all sites for the user
sitesRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, 
        COUNT(DISTINCT i.id) FILTER (WHERE i.resolved_at IS NULL) as open_incidents,
        COUNT(DISTINCT t.id) as flow_count,
        (SELECT COUNT(*) FROM vigil_page_checks pc WHERE pc.site_id = s.id) as total_checks
       FROM vigil_sites s
       LEFT JOIN vigil_incidents i ON i.site_id = s.id
       LEFT JOIN vigil_transactions t ON t.site_id = s.id
       WHERE s.config->>'user_id' = $1 OR s.project_id IS NOT NULL
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      [String(req.userId)]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vigil/sites – create a site
sitesRouter.post('/', async (req: AuthRequest, res) => {
  const { name, url, config = {} } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });

  try {
    const result = await db.query(
      `INSERT INTO vigil_sites (name, url, config, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [name, url, JSON.stringify({ ...config, user_id: req.userId })]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/vigil/sites/:id – update config
sitesRouter.patch('/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const result = await db.query(
      `UPDATE vigil_sites SET config = config || $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(updates), id]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vigil/sites/:id
sitesRouter.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM vigil_sites WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});
