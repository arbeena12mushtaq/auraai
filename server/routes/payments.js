const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const PLANS = {
  starter: { priceAmount: 999, name: 'Starter', messages: 500, companions: 1 },
  plus: { priceAmount: 1999, name: 'Plus', messages: 2000, companions: 3 },
  premium: { priceAmount: 3999, name: 'Premium', messages: 999999, companions: 10 },
};

// Create Stripe Checkout Session — redirects user to Stripe payment page
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey || stripeKey === 'your-stripe-key') {
      // Demo mode fallback — activate plan directly
      console.log('⚠️ No Stripe key — using demo mode');
      await pool.query(
        'UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0, messages_reset_at = NOW() WHERE id = $2',
        [plan, req.user.id]
      );
      await pool.query(
        'INSERT INTO payments (user_id, amount, plan, payment_method, payment_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.user.id, PLANS[plan].priceAmount / 100, plan, 'demo', `demo_${Date.now()}`, 'completed']
      );
      return res.json({ demo: true, success: true });
    }

    const stripe = require('stripe')(stripeKey);

    // Get or create Stripe customer
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

    // Determine base URL
    const baseUrl = process.env.CLIENT_URL || `https://${req.headers.host}`;

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Aura AI ${PLANS[plan].name} Plan`,
            description: `${PLANS[plan].messages === 999999 ? 'Unlimited' : PLANS[plan].messages} messages/mo, ${PLANS[plan].companions} companion(s)`,
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

    console.log(`💳 Stripe checkout created for ${user.email} — ${plan} plan`);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Payment processing failed. Please try again.' });
  }
});

// Stripe Webhook — confirms payment and activates plan
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
    console.error('Webhook signature error:', err.message);
    return res.status(400).send('Webhook error');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.userId;
    const plan = session.metadata?.plan;

    if (userId && plan) {
      await pool.query(
        'UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0, messages_reset_at = NOW() WHERE id = $2',
        [plan, userId]
      );
      await pool.query(
        'INSERT INTO payments (user_id, amount, plan, payment_method, payment_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, (session.amount_total || 0) / 100, plan, 'stripe', session.id, 'completed']
      );
      console.log(`✅ Payment confirmed: ${userId} → ${plan} plan`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    await pool.query(
      "UPDATE users SET plan = NULL WHERE stripe_customer_id = $1",
      [customerId]
    );
    console.log(`⚠️ Subscription cancelled: ${customerId}`);
  }

  res.json({ received: true });
});

// Confirm payment after redirect (called by frontend after Stripe redirect)
router.post('/confirm', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    // Check if user already has this plan (set by webhook)
    const userResult = await pool.query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows[0]?.plan === plan) {
      return res.json({ success: true, message: 'Plan already active' });
    }

    // If webhook hasn't fired yet, activate anyway (webhook will confirm later)
    await pool.query(
      'UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0, messages_reset_at = NOW() WHERE id = $2',
      [plan, req.user.id]
    );

    const user = await pool.query(
      'SELECT id, email, name, plan, messages_used, trial_start, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );

    res.json({ success: true, user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Legacy subscribe endpoint (demo mode)
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    // Redirect to Stripe checkout if key exists
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey && stripeKey !== 'your-stripe-key') {
      return res.status(400).json({ error: 'Use /create-checkout for real payments', useCheckout: true });
    }

    // Demo mode
    await pool.query(
      'UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0 WHERE id = $2',
      [plan, req.user.id]
    );
    await pool.query(
      'INSERT INTO payments (user_id, amount, plan, payment_method, payment_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, PLANS[plan].priceAmount / 100, plan, 'demo', `demo_${Date.now()}`, 'completed']
    );

    const user = await pool.query(
      'SELECT id, email, name, plan, messages_used, trial_start, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );

    res.json({ success: true, user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Payment history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
