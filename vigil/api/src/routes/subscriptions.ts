import { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db';
import { AuthRequest } from '../middleware/auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2023-10-16' });
export const subscriptionsRouter = Router();

const PRICE_IDS: Record<string, string> = {
  growth:   process.env.STRIPE_GROWTH_PRICE_ID  || '',
  business: process.env.STRIPE_BUSINESS_PRICE_ID || '',
  pro:      process.env.STRIPE_PRO_PRICE_ID       || '',
};

subscriptionsRouter.get('/status', async (req: AuthRequest, res) => {
  const result = await db.query(
    'SELECT tier, current_period_end FROM vigil_subscriptions WHERE user_id = $1',
    [req.userId]
  );
  res.json(result.rows[0] || { tier: 'free' });
});

subscriptionsRouter.post('/checkout', async (req: AuthRequest, res) => {
  const { tier } = req.body;
  const priceId = PRICE_IDS[tier];
  if (!priceId) return res.status(400).json({ error: 'Invalid tier' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.DASHBOARD_URL}/vigil/incidents?upgraded=true`,
      cancel_url: `${process.env.DASHBOARD_URL}/vigil/incidents`,
      metadata: { userId: String(req.userId), tier },
    });
    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
