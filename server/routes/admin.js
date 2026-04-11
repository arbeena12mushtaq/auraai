const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Dashboard stats
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [users, companions, messages, payments, paidUsers] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM companions'),
      pool.query('SELECT COUNT(*) FROM messages'),
      pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = $1', ['completed']),
      pool.query("SELECT COUNT(*) FROM users WHERE plan IS NOT NULL AND plan != ''"),
    ]);

    res.json({
      stats: {
        totalUsers: parseInt(users.rows[0].count),
        totalCompanions: parseInt(companions.rows[0].count),
        totalMessages: parseInt(messages.rows[0].count),
        totalRevenue: parseFloat(payments.rows[0].total),
        paidUsers: parseInt(paidUsers.rows[0].count),
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, plan, messages_used, trial_start, is_admin, created_at 
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all companions
router.get('/companions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name as creator_name, u.email as creator_email
       FROM companions c
       LEFT JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC`
    );
    res.json({ companions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all payments
router.get('/payments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name as user_name, u.email as user_email
       FROM payments p
       INNER JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC`
    );
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND is_admin = false', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user plan (admin override)
router.put('/users/:id/plan', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    await pool.query(
      'UPDATE users SET plan = $1, messages_used = 0, plan_started_at = NOW() WHERE id = $2',
      [plan, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add preset companion (admin)
router.post('/presets', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, category, ethnicity, age_range, personality, tagline, 
            hair_color, hair_style, eye_color, body_type, voice, hobbies, avatar_url, description } = req.body;
    
    const result = await pool.query(
      `INSERT INTO companions (name, category, ethnicity, age_range, personality, tagline, 
       hair_color, hair_style, eye_color, body_type, voice, hobbies, avatar_url, description, is_preset, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,true) RETURNING *`,
      [name, category, ethnicity, age_range, personality, tagline,
       hair_color, hair_style, eye_color, body_type, voice, hobbies || [], avatar_url, description]
    );
    
    res.status(201).json({ companion: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Force reseed presets (admin) — use this to update avatar URLs
router.post('/reseed-presets', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM companions WHERE is_preset = true');
    // Reimport database init to reseed
    const { initDatabase } = require('../config/database');
    await initDatabase();
    res.json({ success: true, message: 'Presets reseeded with new images' });
  } catch (err) {
    console.error('Reseed error:', err);
    res.status(500).json({ error: 'Reseed failed' });
  }
});

module.exports = router;
