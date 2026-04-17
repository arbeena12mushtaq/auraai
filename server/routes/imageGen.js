const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const TOKEN_COSTS = { image: 5, video: 15 };

// Deduct tokens from user
async function deductTokens(userId, amount, action, description) {
  const user = await pool.query('SELECT tokens, is_admin FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]) throw { code: 'NOT_FOUND', error: 'User not found' };
  if (user.rows[0].is_admin) return true; // Admin = free
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

// Build a scene prompt from the companion's description + context
function buildScenePrompt(companion, context) {
  const desc = companion.description || '';
  const name = companion.name || 'woman';
  const gender = companion.category === 'Guys' ? 'man' : 'woman';
  const isAnime = companion.art_style === 'Anime';

  // Random scene settings
  const settings = [
    'at a cozy coffee shop, warm lighting, sitting by the window',
    'at the beach during golden hour, ocean in background',
    'in a modern apartment, relaxing on the couch',
    'at a rooftop restaurant at night, city lights behind',
    'in a garden with flowers, soft natural light',
    'at a park in autumn, fallen leaves around',
    'in a bedroom with morning sunlight coming through curtains',
    'at a library, surrounded by books, peaceful atmosphere',
    'walking down a city street at sunset',
    'at a music festival, colorful lights in background',
    'in a kitchen cooking, casual and happy',
    'at a gym, athletic pose, sporty outfit',
  ];

  const outfits = [
    'wearing a casual dress',
    'in a stylish top and jeans',
    'wearing a cozy sweater',
    'in a summer dress',
    'wearing a fitted blazer',
    'in athletic wear',
    'wearing a cute crop top and skirt',
    'in elegant evening wear',
    'wearing a silk blouse',
    'in a trendy streetwear outfit',
  ];

  const setting = settings[Math.floor(Math.random() * settings.length)];
  const outfit = outfits[Math.floor(Math.random() * outfits.length)];

  let prompt;
  if (isAnime) {
    prompt = `Anime illustration of a ${gender}, ${desc}. ${setting}, ${outfit}. High quality anime art, vibrant colors, detailed, beautiful lighting`;
  } else {
    prompt = `Professional photograph of a ${gender}, ${desc}. ${setting}, ${outfit}. High quality photo, realistic, sharp focus, beautiful lighting, portrait style`;
  }

  return prompt;
}

// Generate with OpenAI DALL-E
async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt + '. Safe for work, fully clothed, tasteful.',
        n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json',
      }),
    });
    if (!res.ok) { console.error('DALL-E error:', res.status); return null; }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch (err) { console.error('DALL-E error:', err.message); return null; }
}

// Generate with Together AI (cheaper)
async function generateWithTogetherAI(prompt) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell-Free',
        prompt, negative_prompt: 'nsfw, nude, naked, sexual, violence, gore, ugly, deformed',
        width: 768, height: 768, steps: 4, n: 1, response_format: 'b64_json',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch (err) { return null; }
}

// ===== Generate avatar during character creation (free, no tokens) =====
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    if (req.body.description && !contentFilter(req.body.description)) {
      return res.status(400).json({ error: 'Description contains inappropriate content' });
    }
    if (!req.body.description?.trim()) {
      return res.status(400).json({ error: 'Please provide a description.' });
    }

    const gender = req.body.category === 'Guys' ? 'man' : 'woman';
    const isAnime = req.body.art_style === 'Anime';
    const desc = req.body.description.trim();

    let prompt;
    if (isAnime) {
      prompt = `Anime character portrait of a ${gender}. ${desc}. Clean anime art, vibrant colors, detailed eyes, high quality digital illustration, casual outfit`;
    } else {
      prompt = `Professional portrait photograph of a ${gender}. ${desc}. Soft natural lighting, warm colors, genuine expression, looking at camera, sharp focus, high quality photograph`;
    }

    console.log('🎨 Avatar prompt:', prompt.substring(0, 120) + '...');

    let imageBuffer = await generateWithOpenAI(prompt);
    let provider = imageBuffer ? 'openai' : '';

    if (!imageBuffer) {
      imageBuffer = await generateWithTogetherAI(prompt);
      if (imageBuffer) provider = 'together';
    }

    if (!imageBuffer) {
      return res.status(500).json({ error: 'Image generation unavailable. Upload manually.' });
    }

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);
    console.log(`✅ Avatar saved: ${filename} (${Math.round(imageBuffer.length / 1024)}KB)`);

    res.json({ avatar_url: `/uploads/${filename}`, provider });
  } catch (err) {
    console.error('Avatar gen error:', err);
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// ===== Generate scene photo (costs tokens) =====
router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId, context } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    // Get companion
    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    // Deduct tokens
    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    // Build scene prompt
    const prompt = buildScenePrompt(companion, context);
    console.log('📸 Scene prompt:', prompt.substring(0, 120) + '...');

    let imageBuffer = await generateWithOpenAI(prompt);
    let provider = imageBuffer ? 'openai' : '';

    if (!imageBuffer) {
      imageBuffer = await generateWithTogetherAI(prompt);
      if (imageBuffer) provider = 'together';
    }

    if (!imageBuffer) {
      // Refund tokens
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.image, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    const filename = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);

    // Save as message
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, `📸 here's a photo for you`, `/uploads/${filename}`]
    );

    console.log(`✅ Scene photo: ${filename} (${provider})`);
    res.json({ image_url: `/uploads/${filename}`, caption: `📸 here's a photo for you`, provider });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene gen error:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// ===== Generate video (costs tokens, uses image-to-video API) =====
router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId, context } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    // Deduct tokens
    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    // Step 1: Generate a scene image first
    const prompt = buildScenePrompt(companion, context);
    console.log('🎬 Video scene prompt:', prompt.substring(0, 120) + '...');

    let imageBuffer = await generateWithOpenAI(prompt);
    if (!imageBuffer) imageBuffer = await generateWithTogetherAI(prompt);

    if (!imageBuffer) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.video, req.user.id]);
      return res.status(500).json({ error: 'Video generation failed. Tokens refunded.' });
    }

    // Save the image
    const imgFilename = `vscene-${Date.now()}.png`;
    const imgPath = path.join(uploadDir, imgFilename);
    fs.writeFileSync(imgPath, imageBuffer);

    // Step 2: Try image-to-video API (Runway, Luma, Kling, etc.)
    // For now, fall back to serving the image as the "video frame"
    // TODO: Integrate actual image-to-video API when you have one

    const runwayKey = process.env.RUNWAY_API_KEY;
    const lumaKey = process.env.LUMA_API_KEY;

    // Attempt Luma AI (Dream Machine) if key exists
    if (lumaKey) {
      try {
        console.log('🎬 Trying Luma AI video generation...');
        // Luma's API would go here
        // For now, fall through to image fallback
      } catch (e) {
        console.error('Luma error:', e.message);
      }
    }

    // Attempt Runway ML if key exists
    if (runwayKey) {
      try {
        console.log('🎬 Trying Runway ML video generation...');
        // Runway's API would go here
        // For now, fall through to image fallback
      } catch (e) {
        console.error('Runway error:', e.message);
      }
    }

    // Fallback: Return the generated image (video APIs not yet configured)
    // Refund partial tokens (image was generated, just not video)
    const refund = TOKEN_COSTS.video - TOKEN_COSTS.image;
    if (refund > 0) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [refund, req.user.id]);
    }

    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, `📸 here's a moment for you`, `/uploads/${imgFilename}`]
    );

    console.log(`📸 Video fallback to image: ${imgFilename}`);
    res.json({
      image_url: `/uploads/${imgFilename}`,
      video_url: null,
      caption: `📸 here's a moment for you`,
      note: 'Video generation requires RUNWAY_API_KEY or LUMA_API_KEY. Showing image instead.',
    });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video gen error:', err);
    res.status(500).json({ error: 'Video generation failed' });
  }
});

module.exports = router;
