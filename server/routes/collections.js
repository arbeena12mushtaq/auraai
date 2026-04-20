const express = require('express');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get user's collection
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.* FROM companions c
       INNER JOIN collections col ON col.companion_id = c.id
       WHERE col.user_id = $1
       ORDER BY col.created_at DESC`,
      [req.user.id]
    );
    res.json({ companions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add to collection
router.post('/:companionId', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO collections (user_id, companion_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, req.params.companionId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove from collection
router.delete('/:companionId', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM collections WHERE user_id = $1 AND companion_id = $2',
      [req.user.id, req.params.companionId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if in collection
router.get('/check/:companionId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id FROM collections WHERE user_id = $1 AND companion_id = $2',
      [req.user.id, req.params.companionId]
    );
    res.json({ inCollection: result.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
