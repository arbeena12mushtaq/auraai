const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { getPuter, isPuterReady, getPuterInitError } = require('../puterClient');

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

function getRandomScene() {
  const scenes = [
    { setting: 'cozy coffee shop, warm lighting, sitting by window', outfit: 'elegant knit sweater and tailored trousers' },
    { setting: 'beach during golden hour, ocean behind', outfit: 'flowy maxi dress, bohemian resort styling' },
    { setting: 'rooftop restaurant, city lights, night', outfit: 'sleek black evening dress with jacket' },
    { setting: 'garden with flowers, soft sunlight', outfit: 'floral midi dress, romantic elegant styling' },
    { setting: 'park in autumn, golden leaves', outfit: 'leather jacket over turtleneck and skirt' },
    { setting: 'library with wooden shelves, warm light', outfit: 'tailored blazer and smart trousers' },
    { setting: 'cobblestone street at sunset, European city', outfit: 'fitted trench coat over designer dress' },
    { setting: 'art gallery, white walls, modern art', outfit: 'minimalist black outfit, gallery-chic' },
    { setting: 'mountain viewpoint, misty landscape', outfit: 'stylish outdoor coat and boots' },
    { setting: 'rainy city street, neon reflections, night', outfit: 'sleek dark coat, noir fashion' },
  ];
  const cameras = [
    'selfie angle, front facing',
    'close-up portrait, looking at camera',
    'medium shot, 3/4 angle, natural pose',
    'full body shot, standing pose',
    'candid side profile, soft focus background',
  ];
  const s = scenes[Math.floor(Math.random() * scenes.length)];
  const c = cameras[Math.floor(Math.random() * cameras.length)];
  return { setting: s.setting, outfit: s.outfit, camera: c };
}

async function generateWithPollinations(prompt, width = 1024, height = 1024) {
  try {
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&model=flux`;
    const res = await fetch(url);
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('image')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 3000) return null;
    return buffer;
  } catch (err) {
    console.error('Pollinations:', err.message);
    return null;
  }
}

async function avatarToBase64(avatarUrl, req) {
  if (!avatarUrl) return null;
  try {
    if (avatarUrl.startsWith('/uploads/')) {
      const localPath = path.join(uploadDir, path.basename(avatarUrl));
      if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath).toString('base64');
      }
    }

    const absoluteUrl = avatarUrl.startsWith('http')
      ? avatarUrl
      : `${req.protocol}://${req.get('host')}${avatarUrl}`;

    const res = await fetch(absoluteUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  } catch (err) {
    console.error('Avatar base64 error:', err.message);
    return null;
  }
}

function normalizeMediaUrl(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  return result.src || result.url || result.image_url || result.video_url || result?.data?.[0]?.url || null;
}

async function saveMediaMessage({ userId, companionId, type, mediaUrl, caption }) {
  const saved = await pool.query(
    `INSERT INTO messages (user_id, companion_id, role, content, type, media_url)
     VALUES ($1,$2,'assistant',$3,$4,$5)
     RETURNING created_at`,
    [userId, companionId, caption, type, mediaUrl]
  );
  return saved.rows[0]?.created_at || new Date().toISOString();
}

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
      prompt = `photorealistic portrait of a mythical ${gender}, ${desc}, professional photography, 85mm lens, natural lighting, detailed skin, front facing, looking at camera, high resolution, fantasy character`;
    }

    let imageBuffer = await generateWithPollinations(prompt);
    if (!imageBuffer) return res.status(500).json({ error: 'Image generation failed. Try uploading.' });

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);

    res.json({ avatar_url: `/uploads/${filename}` });
  } catch (err) {
    console.error('Avatar error:', err);
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    const { setting, outfit, camera } = getRandomScene();
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const desc = sanitizePrompt(companion.description || companion.personality || '');

    const editPrompt = `Edit this photo. Keep the exact same person, same face, same features, same wings if any. Place them in: ${setting}. Dress them in: ${outfit}. Camera angle: ${camera}. Photorealistic, professional fashion photography, tasteful, fully clothed.`;
    const fallbackPrompt = `photorealistic mythical ${gender}, ${desc}, in ${setting}, wearing ${outfit}, ${camera}, professional editorial photography, natural lighting, tasteful, fully clothed`;

    let imageUrl = null;
    let provider = null;

    if (isPuterReady()) {
      const puter = getPuter();
      const avatarBase64 = await avatarToBase64(companion.avatar_url, req);

      if (avatarBase64) {
        try {
          const result = await puter.ai.txt2img(editPrompt, {
            provider: 'gemini',
            model: 'gemini-2.5-flash-image-preview',
            input_images: [avatarBase64],
          });
          imageUrl = normalizeMediaUrl(result);
          provider = 'puter';
        } catch (err) {
          console.error('Puter image edit failed:', err?.message || err);
        }
      }

      if (!imageUrl) {
        try {
          const result = await puter.ai.txt2img(fallbackPrompt, {
            provider: 'gemini',
            model: 'gemini-2.5-flash-image-preview',
          });
          imageUrl = normalizeMediaUrl(result);
          provider = 'puter';
        } catch (err) {
          console.error('Puter text-to-image failed:', err?.message || err);
        }
      }
    } else {
      const initErr = getPuterInitError();
      if (initErr) console.warn('Puter not ready, using fallback:', initErr.message || initErr);
    }

    if (!imageUrl) {
      const imageBuffer = await generateWithPollinations(fallbackPrompt);
      if (!imageBuffer) throw new Error('Image generation failed');
      const filename = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
      fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);
      imageUrl = `/uploads/${filename}`;
      provider = 'pollinations';
    }

    const createdAt = await saveMediaMessage({
      userId: req.user.id,
      companionId,
      type: 'image',
      mediaUrl: imageUrl,
      caption: '📸',
    });

    res.json({ success: true, imageUrl, provider, created_at: createdAt });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Generate scene error:', err);
    res.status(500).json({ error: err?.message || err?.error || 'Image generation failed' });
  }
});

router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    if (!isPuterReady()) {
      const initErr = getPuterInitError();
      return res.status(503).json({ error: initErr?.message || 'Puter is not configured. Add PUTER_AUTH_TOKEN to enable video generation.' });
    }

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    const { setting, outfit } = getRandomScene();
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const desc = sanitizePrompt(companion.description || companion.personality || '');
    const prompt = `A ${gender}, ${desc}, in ${setting}, wearing ${outfit}, slight natural movement, soft smile, cinematic lighting, photorealistic, tasteful, fully clothed`;

    const puter = getPuter();
    const result = await puter.ai.txt2vid(prompt, {
      model: 'veo-3.1-lite-generate-preview',
      seconds: 4,
    });

    const videoUrl = normalizeMediaUrl(result);
    if (!videoUrl) throw new Error('No video URL returned');

    const createdAt = await saveMediaMessage({
      userId: req.user.id,
      companionId,
      type: 'video',
      mediaUrl: videoUrl,
      caption: '🎬',
    });

    res.json({ success: true, videoUrl, created_at: createdAt });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Generate video error:', err);
    res.status(500).json({ error: err?.message || err?.error || 'Video generation failed' });
  }
});

router.post('/deduct-tokens', authMiddleware, async (req, res) => {
  try {
    const { action, amount, description } = req.body;
    const cost = amount || TOKEN_COSTS[action] || TOKEN_COSTS.image;

    await deductTokens(req.user.id, cost, action || 'image_gen', description || 'Media generation');

    res.json({ success: true, deducted: cost });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Deduct error:', err);
    res.status(500).json({ error: 'Token deduction failed' });
  }
});

router.post('/save-media', authMiddleware, async (req, res) => {
  try {
    const { companionId, type, mediaUrl, caption } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    await saveMediaMessage({
      userId: req.user.id,
      companionId,
      type: type || 'image',
      mediaUrl: mediaUrl || '',
      caption: caption || '📸',
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Save media error:', err);
    res.status(500).json({ error: 'Failed to save media' });
  }
});

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
