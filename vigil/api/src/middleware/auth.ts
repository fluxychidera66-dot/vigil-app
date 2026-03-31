/**
 * Auth middleware – validates JWT issued by OpenReplay backend.
 * Attaches userId to req for downstream use.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export interface AuthRequest extends Request {
  userId?: number;
  userTier?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.userId = decoded.userId || decoded.id || decoded.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function tierMiddleware(requiredTier: 'growth' | 'business' | 'pro') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { db } = await import('../db');
    const result = await db.query(
      'SELECT tier FROM vigil_subscriptions WHERE user_id = $1',
      [req.userId]
    );
    const tier = result.rows[0]?.tier || 'free';
    const tiers = ['free', 'growth', 'business', 'pro'];
    if (tiers.indexOf(tier) < tiers.indexOf(requiredTier)) {
      return res.status(403).json({ error: `Requires ${requiredTier} plan`, upgrade: true });
    }
    req.userTier = tier;
    next();
  };
}
