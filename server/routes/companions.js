const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();

// Setup multer for avatar uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

// Get all preset companions
router.get('/presets', async (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT * FROM companions WHERE is_preset = true';
    const params = [];
    
    if (category && category !== 'All') {
      query += ' AND category = $1';
      params.push(category);
    }
    query += ' ORDER BY created_at ASC';
    
    const result = await pool.query(query, params);
    res.json({ companions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all public companions (discover page)
router.get('/discover', async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = 'SELECT * FROM companions WHERE (is_preset = true OR is_public = true)';
    const params = [];
    let idx = 1;

    if (category && category !== 'All') {
      query += ` AND category = $${idx++}`;
      params.push(category);
    }
    if (search) {
      query += ` AND (name ILIKE $${idx} OR personality ILIKE $${idx} OR tagline ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    query += ' ORDER BY is_preset DESC, created_at DESC';

    const result = await pool.query(query, params);
    res.json({ companions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single companion
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM companions WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    res.json({ companion: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create companion
router.post('/', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    const { name, category, art_style, ethnicity, age_range, eye_color, hair_style, hair_color,
            body_type, personality, voice, hobbies, description, tagline } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!contentFilter(name) || !contentFilter(description || '') || !contentFilter(tagline || '')) {
      return res.status(400).json({ error: 'Content violates community guidelines' });
    }

    // Check companion slots
    const user = await pool.query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
    const plan = user.rows[0]?.plan;
    const limits = { starter: 1, plus: 3, premium: 10 };
    const maxSlots = req.user.is_admin ? 999 : (plan ? (limits[plan] || 1) : 1);

    const currentCount = await pool.query(
      'SELECT COUNT(*) FROM companions WHERE user_id = $1 AND is_preset = false',
      [req.user.id]
    );
    if (parseInt(currentCount.rows[0].count) >= maxSlots) {
      return res.status(403).json({ error: 'Companion slot limit reached. Upgrade your plan.' });
    }

    let avatar_url = null;
    if (req.file) {
      avatar_url = `/uploads/${req.file.filename}`;
    }

    const parsedHobbies = hobbies ? (typeof hobbies === 'string' ? JSON.parse(hobbies) : hobbies) : [];

    const result = await pool.query(
      `INSERT INTO companions (user_id, name, category, art_style, ethnicity, age_range, eye_color, 
       hair_style, hair_color, body_type, personality, voice, hobbies, description, tagline, avatar_url, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false)
       RETURNING *`,
      [req.user.id, name, category||'Girls', art_style||'Realistic', ethnicity, age_range,
       eye_color, hair_style, hair_color, body_type, personality, voice, parsedHobbies,
       description, tagline || `${personality} companion`, avatar_url]
    );

    res.status(201).json({ companion: result.rows[0] });
  } catch (err) {
    console.error('Create companion error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's companions
router.get('/user/mine', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM companions WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ companions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete companion
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM companions WHERE id = $1 AND (user_id = $2 OR $3 = true)',
      [req.params.id, req.user.id, req.user.is_admin]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
