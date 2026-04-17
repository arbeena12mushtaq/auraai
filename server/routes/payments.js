const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const PLANS = {
  starter: { priceAmount: 999, name: 'Starter', messages: 500, companions: 1, tokens: 50 },
  plus: { priceAmount: 1999, name: 'Plus', messages: 2000, companions: 3, tokens: 150 },
  premium: { priceAmount: 3999, name: 'Premium', messages: 999999, companions: 10, tokens: 500 },
};

// Create Stripe Checkout Session
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey || stripeKey === 'your-stripe-key') {
      // No Stripe key = reject, don't silently activate
      return res.status(400).json({
        error: 'Payment system not configured. Please set STRIPE_SECRET_KEY.',
        demo: false,
      });
    }

    const stripe = require('stripe')(stripeKey);

    const userResult = await pool.query('SELECT email, name, stripe_customer_id FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
    }

    const baseUrl = process.env.CLIENT_URL || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Aura AI ${PLANS[plan].name} Plan`,
            description: `${PLANS[plan].messages === 999999 ? 'Unlimited' : PLANS[plan].messages} msgs/mo, ${PLANS[plan].companions} companion(s), ${PLANS[plan].tokens} tokens/mo`,
          },
          unit_amount: PLANS[plan].priceAmount,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${baseUrl}?payment=success&plan=${plan}`,
      cancel_url: `${baseUrl}?payment=cancelled`,
      client_reference_id: req.user.id,
      metadata: { plan, userId: req.user.id },
    });

    console.log(`💳 Stripe checkout for ${user.email} — ${plan}`);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Payment failed. Please try again.' });
  }
});

// Stripe Webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(400).send('No Stripe key');

  const stripe = require('stripe')(stripeKey);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send('Webhook error');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.userId;
    const plan = session.metadata?.plan;

    if (userId && plan && PLANS[plan]) {
      await pool.query(
        'UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0, messages_reset_at = NOW(), tokens = tokens + $3 WHERE id = $2',
        [plan, userId, PLANS[plan].tokens]
      );
      await pool.query(
        'INSERT INTO payments (user_id, amount, plan, payment_method, payment_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, (session.amount_total || 0) / 100, plan, 'stripe', session.id, 'completed']
      );
      await pool.query(
        'INSERT INTO token_ledger (user_id, amount, action, description) VALUES ($1,$2,$3,$4)',
        [userId, PLANS[plan].tokens, 'plan_purchase', `${PLANS[plan].name} plan — ${PLANS[plan].tokens} tokens`]
      );
      console.log(`✅ Payment confirmed: ${userId} → ${plan} (+${PLANS[plan].tokens} tokens)`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await pool.query("UPDATE users SET plan = NULL WHERE stripe_customer_id = $1", [subscription.customer]);
    console.log(`⚠️ Subscription cancelled: ${subscription.customer}`);
  }

  res.json({ received: true });
});

// Confirm payment after Stripe redirect
router.post('/confirm', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    const userResult = await pool.query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows[0]?.plan === plan) {
      return res.json({ success: true, message: 'Plan already active' });
    }

    // Only activate if webhook hasn't already (give webhook 5 seconds)
    // Don't auto-activate without payment
    const user = await pool.query(
      'SELECT id, email, name, plan, messages_used, tokens, trial_start, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ success: true, user: user.rows[0] });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Legacy subscribe — only for admin testing
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    // Only allow admin to use demo subscribe
    const userCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    if (!userCheck.rows[0]?.is_admin) {
      return res.status(400).json({ error: 'Please use the checkout page for real payments.', useCheckout: true });
    }

    // Admin demo mode
    await pool.query(
      'UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0, tokens = tokens + $3 WHERE id = $2',
      [plan, req.user.id, PLANS[plan].tokens]
    );
    await pool.query(
      'INSERT INTO payments (user_id, amount, plan, payment_method, payment_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, PLANS[plan].priceAmount / 100, plan, 'admin-demo', `demo_${Date.now()}`, 'completed']
    );

    const user = await pool.query(
      'SELECT id, email, name, plan, messages_used, tokens, trial_start, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ success: true, user: user.rows[0] });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Payment history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ payments: result.rows });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
