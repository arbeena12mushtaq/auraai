const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const TOKEN_COSTS = { image: 5, video: 15 };

async function deductTokens(userId, amount, action, description) {
  const user = await pool.query('SELECT tokens, is_admin FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]) throw { code: 'NOT_FOUND', error: 'User not found' };
  if (user.rows[0].is_admin) return true;
  if ((user.rows[0].tokens || 0) < amount) {
    throw { code: 'NO_TOKENS', error: `Not enough tokens. Need ${amount}, have ${user.rows[0].tokens || 0}` };
  }
  await pool.query('UPDATE users SET tokens = tokens - $1 WHERE id = $2', [amount, userId]);
  await pool.query(
    'INSERT INTO token_ledger (user_id, amount, action, description) VALUES ($1, $2, $3, $4)',
    [userId, -amount, action, description]
  );
  return true;
}

function sanitizePrompt(text) {
  return (text || '')
    .replace(/\b(nude|naked|nsfw|explicit|topless|bottomless|genitals|penis|vagina|porn|xxx|sexual|erotic)\b/gi, '')
    .replace(/\bsexy\b/gi, 'glamorous')
    .replace(/\bhot\b/gi, 'stunning')
    .replace(/\bseductive\b/gi, 'elegant')
    .replace(/\bsensual\b/gi, 'refined')
    .replace(/\balluring\b/gi, 'stylish')
    .replace(/\bfantasy\b/gi, 'mythical')
    .replace(/\bsuccubus\b/gi, 'dark angel')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pollinations — FREE, no API key, for avatar fallback
async function generateWithPollinations(prompt, width = 1024, height = 1024) {
  try {
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&model=flux`;
    console.log(`🌸 Pollinations (seed:${seed})...`);
    const res = await fetch(url);
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('image')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 3000) return null;
    console.log(`✅ Pollinations (${Math.round(buffer.length / 1024)}KB)`);
    return buffer;
  } catch (err) { console.error('Pollinations:', err.message); return null; }
}

// ===== ROUTES =====

// --- Avatar creation (server-side, used during character creation) ---
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    if (!req.body.description?.trim()) {
      return res.status(400).json({ error: 'Please provide a description.' });
    }

    const gender = req.body.category === 'Guys' ? 'man' : 'woman';
    const isAnime = req.body.art_style === 'Anime';
    const desc = sanitizePrompt(req.body.description);

    let prompt;
    if (isAnime) {
      prompt = `anime character portrait, ${gender}, ${desc}, anime art, vibrant colors, detailed eyes, front facing, looking at camera, fantasy character design`;
    } else {
      prompt = `photorealistic portrait of a fantasy ${gender}, ${desc}, professional photography, 85mm lens, natural lighting, detailed skin, front facing, looking at camera, high resolution, fantasy character`;
    }

    console.log('🎨 Avatar prompt:', prompt);

    let imageBuffer = await generateWithPollinations(prompt);
    if (!imageBuffer) return res.status(500).json({ error: 'Image generation failed. Try uploading.' });

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);
    console.log(`✅ Avatar: ${filename}`);

    res.json({ avatar_url: `/uploads/${filename}` });
  } catch (err) {
    console.error('Avatar error:', err);
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// --- Deduct tokens for image generation (called from frontend after Puter.js generates) ---
router.post('/deduct-tokens', authMiddleware, async (req, res) => {
  try {
    const { action, amount, companionId, description } = req.body;
    const cost = amount || TOKEN_COSTS[action] || TOKEN_COSTS.image;
    
    await deductTokens(req.user.id, cost, action || 'image_gen', description || 'Media generation');
    
    res.json({ success: true, deducted: cost });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Deduct error:', err);
    res.status(500).json({ error: 'Token deduction failed' });
  }
});

// --- Save generated media message to DB ---
router.post('/save-media', authMiddleware, async (req, res) => {
  try {
    const { companionId, type, mediaUrl, caption } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });
    
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,$4,$5)`,
      [req.user.id, companionId, caption || '📸', type || 'image', mediaUrl || '']
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Save media error:', err);
    res.status(500).json({ error: 'Failed to save media' });
  }
});

// --- Get companion data (for frontend to access avatar for editing) ---
router.get('/companion/:id', authMiddleware, async (req, res) => {
  try {
    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ companion: comp.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
