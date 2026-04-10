const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const PLANS = {
  starter: { price: 999, name: 'Starter', messages: 500, companions: 1 },
  plus: { price: 1999, name: 'Plus', messages: 2000, companions: 3 },
  premium: { price: 3999, name: 'Premium', messages: 999999, companions: 10 },
};

// Subscribe to plan (demo mode without real Stripe)
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { plan, payment_method } = req.body;

    if (!PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const planInfo = PLANS[plan];

    // In production, integrate Stripe here:
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // const paymentIntent = await stripe.paymentIntents.create({...});

    // Update user plan
    await pool.query(
      `UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0, messages_reset_at = NOW()
       WHERE id = $2`,
      [plan, req.user.id]
    );

    // Record payment
    await pool.query(
      `INSERT INTO payments (user_id, amount, plan, payment_method, payment_id, status)
       VALUES ($1, $2, $3, $4, $5, 'completed')`,
      [req.user.id, planInfo.price / 100, plan, payment_method || 'card', `demo_${Date.now()}`]
    );

    const user = await pool.query(
      'SELECT id, email, name, plan, messages_used, trial_start, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );

    res.json({ 
      success: true, 
      user: user.rows[0],
      message: `Successfully subscribed to ${planInfo.name} plan!` 
    });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

// Create Stripe checkout session (for production)
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    if (process.env.STRIPE_SECRET_KEY) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `Aura AI ${PLANS[plan].name} Plan` },
            unit_amount: PLANS[plan].price,
            recurring: { interval: 'month' }
          },
          quantity: 1,
        }],
        mode: 'subscription',
        success_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/pricing`,
        client_reference_id: req.user.id,
        metadata: { plan }
      });
      return res.json({ url: session.url });
    }

    // Demo mode - just subscribe directly
    await pool.query(
      'UPDATE users SET plan = $1, plan_started_at = NOW(), messages_used = 0 WHERE id = $2',
      [plan, req.user.id]
    );
    await pool.query(
      'INSERT INTO payments (user_id, amount, plan, payment_method, payment_id, status) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, PLANS[plan].price / 100, plan, 'demo', `demo_${Date.now()}`, 'completed']
    );

    res.json({ success: true, demo: true });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get payment history
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
