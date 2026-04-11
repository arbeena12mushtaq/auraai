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

// Force reseed presets (admin)
router.post('/reseed-presets', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM companions WHERE is_preset = true');
    const { initDatabase } = require('../config/database');
    await initDatabase();
    res.json({ success: true, message: 'Presets reseeded' });
  } catch (err) {
    console.error('Reseed error:', err);
    res.status(500).json({ error: 'Reseed failed' });
  }
});

// Generate AI avatars for all presets (admin) — costs ~$0.64 for 16 images with DALL-E HD
router.post('/generate-avatars', authMiddleware, adminMiddleware, async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  const fs = require('fs');
  const path = require('path');
  const uploadDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const PROMPTS = {
    'Aria': 'Professional fashion photography headshot of a young woman with blonde wavy hair, blue eyes, warm genuine smile, wearing a cream knit sweater, soft golden hour lighting, magazine quality portrait',
    'Luna': 'Professional portrait of a confident young Latina woman with long dark hair, brown eyes, wearing a stylish leather jacket, urban background blurred, warm tones, editorial fashion photography',
    'Emilia': 'Professional portrait of a young woman with red curly hair, green eyes, playful confident expression, wearing a white blouse, natural outdoor lighting, garden background, fashion photography',
    'Zara': 'Professional portrait of a confident young Black woman with natural curly hair, radiant smile, wearing a vibrant yellow top, studio lighting, fashion editorial style',
    'Mei': 'Professional portrait of a gentle young East Asian woman with straight brown hair, soft warm smile, wearing a light blue cardigan, cafe background blurred, natural lighting',
    'Sofia': 'Professional portrait of a young Latina woman with wavy brown hair, thoughtful expression, wearing earth-tone dress, golden hour outdoor lighting, editorial quality',
    'Nadia': 'Professional portrait of a young Middle Eastern woman with long dark hair, mysterious confident smile, wearing elegant dark clothing, dramatic studio lighting',
    'Elena': 'Professional portrait of a young woman with straight blonde hair, blue eyes, energetic bright smile, wearing athletic casual wear, bright outdoor lighting',
    'Isabella': 'Professional portrait of a young Latina woman with wavy dark hair, warm sweet expression, wearing a floral summer dress, warm sunset lighting',
    'Aisha': 'Professional portrait of a young Black woman with curly natural hair, wise serene expression, wearing elegant earth tones, soft studio lighting, fine art portrait',
    'Kai': 'Professional portrait of a confident young East Asian man with short black hair, charming smile, wearing a fitted dark henley shirt, urban background, editorial photography',
    'Marcus': 'Professional portrait of a warm young Black man with short hair, genuine friendly smile, wearing a casual denim jacket, outdoor natural lighting',
    'Liam': 'Professional portrait of a young man with short brown hair, green eyes, confident smirk, wearing a casual blazer, cafe background, editorial style',
    'Sakura': 'Anime character portrait, young woman with pink straight hair, green eyes, shy gentle expression, pastel school uniform, cherry blossom background, modern anime art, detailed',
    'Yuki': 'Anime character portrait, energetic young woman with short white hair, bright blue eyes, cheerful expression, colorful casual outfit, neon city background, modern anime art',
    'Mia': 'Anime character portrait, gentle young woman with long purple hair, gray eyes, soft shy smile, cozy oversized sweater, rainy window background, modern anime art',
  };

  res.json({ message: `Starting generation of ${Object.keys(PROMPTS).length} avatars. Check server logs for progress.` });

  // Run in background
  (async () => {
    let success = 0;
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      try {
        console.log(`🎨 Generating avatar for ${name}...`);
        const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'hd', response_format: 'b64_json',
          }),
        });

        if (!imgRes.ok) {
          console.log(`  ❌ ${name}: DALL-E rejected (${imgRes.status})`);
          // Retry with simpler prompt
          const simpleRes = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: `Professional headshot portrait of a friendly young person, ${name}, smiling, casual clothing, studio lighting, high quality photograph`,
              n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json',
            }),
          });
          if (!simpleRes.ok) { console.log(`  ❌ ${name}: retry also failed`); continue; }
          const simpleData = await simpleRes.json();
          const buf = Buffer.from(simpleData.data[0].b64_json, 'base64');
          const fn = `preset-${name.toLowerCase()}-${Date.now()}.png`;
          fs.writeFileSync(path.join(uploadDir, fn), buf);
          await pool.query('UPDATE companions SET avatar_url = $1 WHERE name = $2 AND is_preset = true', [`/uploads/${fn}`, name]);
          console.log(`  ✅ ${name}: saved (retry)`);
          success++;
        } else {
          const data = await imgRes.json();
          const buf = Buffer.from(data.data[0].b64_json, 'base64');
          const fn = `preset-${name.toLowerCase()}-${Date.now()}.png`;
          fs.writeFileSync(path.join(uploadDir, fn), buf);
          await pool.query('UPDATE companions SET avatar_url = $1 WHERE name = $2 AND is_preset = true', [`/uploads/${fn}`, name]);
          console.log(`  ✅ ${name}: saved (${Math.round(buf.length / 1024)}KB)`);
          success++;
        }

        await new Promise(r => setTimeout(r, 3000)); // rate limit delay
      } catch (err) {
        console.log(`  ❌ ${name}: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    console.log(`\n🎨 Avatar generation complete: ${success}/${Object.keys(PROMPTS).length} generated`);
  })();
});

module.exports = router;
