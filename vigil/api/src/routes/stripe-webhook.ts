import { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db';
import { logger } from '../logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2023-10-16' });
export const stripeWebhookRouter = Router();

const TIER_MAP: Record<string, string> = {
  [process.env.STRIPE_GROWTH_PRICE_ID   || '']: 'growth',
  [process.env.STRIPE_BUSINESS_PRICE_ID || '']: 'business',
  [process.env.STRIPE_PRO_PRICE_ID      || '']: 'pro',
};

stripeWebhookRouter.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err: any) {
    logger.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const tier = session.metadata?.tier;
      if (!userId || !tier) break;

      await db.query(
        `INSERT INTO vigil_subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO UPDATE SET tier = $2, stripe_customer_id = $3, stripe_subscription_id = $4, updated_at = NOW()`,
        [userId, tier, session.customer, session.subscription]
      );
      logger.info(`User ${userId} subscribed to ${tier}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await db.query(
        'UPDATE vigil_subscriptions SET tier = $1, updated_at = NOW() WHERE stripe_subscription_id = $2',
        ['free', sub.id]
      );
      break;
    }
  }

  res.json({ received: true });
});
