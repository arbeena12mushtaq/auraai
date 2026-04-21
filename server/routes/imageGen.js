const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { img2img, img2video } = require('../services/deapi');

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

function refundTokens(userId, amount) {
  if (!amount || amount <= 0) return Promise.resolve();
  return pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [amount, userId]);
}

function sanitizePrompt(text) {
  return (text || '')
    .replace(/\b(nude|naked|nsfw|explicit|topless|bottomless|genitals|penis|vagina|porn|xxx|sexual|erotic)\b/gi, '')
    .replace(/\bsexy\b/gi, 'glamorous')
    .replace(/\bhot\b/gi, 'stunning')
    .replace(/\bseductive\b/gi, 'elegant')
    .replace(/\bsensual\b/gi, 'refined')
    .replace(/\balluring\b/gi, 'stylish')
    .replace(/\bsuccubus\b/gi, 'winged gothic character')
    .replace(/\s+/g, ' ')
    .trim();
}

function getRandomFantasyScene() {
  const scenes = [
    { setting: 'enchanted moonlit forest with glowing flowers and floating fireflies', outfit: 'ornate fantasy cloak with silver embroidery and fitted leather boots' },
    { setting: 'ancient crystal cave illuminated by blue magical light', outfit: 'mystic battle dress with gemstone accents and elegant arm cuffs' },
    { setting: 'royal castle balcony above the clouds at sunset', outfit: 'regal velvet gown with gold trim and a jeweled cape' },
    { setting: 'gothic throne room with candles, black stone arches, and crimson banners', outfit: 'dark royal attire with intricate lace, polished armor details, and a dramatic mantle' },
    { setting: 'floating sky temple with waterfalls and glowing runes', outfit: 'celestial fantasy robes with luminous patterns and silk layers' },
    { setting: 'snowy mountain pass beside a dragon shrine', outfit: 'fur-lined fantasy travel coat with engraved armor plates' },
    { setting: 'ancient desert ruins under a violet twilight sky', outfit: 'desert fantasy garments with embroidered veil, jewelry, and elegant wraps' },
    { setting: 'mystical library with towering bookshelves and golden spell circles', outfit: 'scholarly sorcerer outfit with embroidered jacket and magical accessories' },
    { setting: 'elven garden with marble statues, waterfalls, and soft glowing lanterns', outfit: 'flowing elven ceremonial attire with leaf-inspired detailing' },
    { setting: 'volcanic obsidian citadel with sparks and molten rivers in the distance', outfit: 'heroic dark armor with glowing accents and a dramatic cape' },
  ];

  const cameras = [
    'cinematic close-up portrait, eyes toward camera, shallow depth of field',
    'medium shot from the waist up, confident stance, dramatic fantasy lighting',
    'full body heroic pose, centered frame, epic cinematic composition',
    '3/4 angle portrait, slight turn toward camera, elegant posture',
    'low-angle power shot, strong heroic presence, fantasy movie still',
    'seated royal portrait, composed expression, richly detailed background',
  ];

  const moods = [
    'majestic and magical',
    'mysterious and elegant',
    'heroic and cinematic',
    'dreamlike and ethereal',
    'dark fantasy and regal',
  ];

  const scene = scenes[Math.floor(Math.random() * scenes.length)];
  return {
    ...scene,
    camera: cameras[Math.floor(Math.random() * cameras.length)],
    mood: moods[Math.floor(Math.random() * moods.length)],
  };
}

async function generateWithPollinations(prompt, width = 1024, height = 1024) {
  try {
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&model=flux`;
    console.log(`🌸 Pollinations avatar (seed:${seed})...`);

    const res = await fetch(url);
    if (!res.ok) {
      console.error('Pollinations failed:', res.status);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 3000) return null;
    return buffer;
  } catch (err) {
    console.error('Pollinations error:', err.message);
    return null;
  }
}

function saveBuffer(prefix, buffer, ext = '.png') {
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), buffer);
  return `/uploads/${filename}`;
}

function publicUrlToLocalPath(url) {
  if (!url) return null;
  if (url.startsWith('/uploads/')) {
    return path.join(uploadDir, path.basename(url));
  }
  return null;
}

function buildCharacterSummary(companion) {
  const gender = companion.category === 'Guys' ? 'male fantasy character' : 'female fantasy character';
  const name = companion.name ? `${companion.name}, ` : '';
  const description = sanitizePrompt(companion.description || '');
  const personality = sanitizePrompt(companion.personality || 'confident and charming');
  const hobbies = Array.isArray(companion.hobbies) ? companion.hobbies.join(', ') : sanitizePrompt(companion.hobbies || companion.hobby || '');

  return [
    name + gender,
    description,
    personality ? `personality: ${personality}` : '',
    hobbies ? `details inspired by: ${hobbies}` : '',
  ].filter(Boolean).join(', ');
}

function scenePromptForCompanion(companion, scene) {
  const character = buildCharacterSummary(companion);
  return [
    `Transform this exact avatar into a high-detail fantasy portrait of ${character}.`,
    `Setting: ${scene.setting}.`,
    `Outfit: ${scene.outfit}.`,
    `Mood: ${scene.mood}.`,
    `Camera: ${scene.camera}.`,
    'Keep the same face identity, same hair, same body proportions, and same core visual identity from the source avatar.',
    'Highly detailed fantasy environment, cinematic composition, polished lighting, premium concept-art realism, tasteful, fully clothed, no text, no watermark.',
  ].join(' ');
}

function videoPromptForCompanion(companion, scene) {
  return [
    `Animate ${companion.name || 'this fantasy character'} in the same fantasy setting: ${scene.setting}.`,
    `Outfit remains: ${scene.outfit}.`,
    'Motion: subtle blinking, gentle breathing, slight head turn, soft hair and fabric movement, cinematic ambient motion.',
    `Mood: ${scene.mood}.`,
    'Keep identity consistent with the first frame, preserve face and styling, smooth natural motion, no distortion, no extra limbs, no text, no watermark.',
  ].join(' ');
}

const DEAPI_IMAGE_NEGATIVE = 'low quality, blurry, distorted face, extra fingers, extra limbs, bad anatomy, cropped, duplicate, text, watermark, nsfw';
const DEAPI_VIDEO_NEGATIVE = 'jitter, flicker, warped face, extra limbs, blurry, distorted anatomy, text, watermark, low quality';

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    if (!req.body.description?.trim()) {
      return res.status(400).json({ error: 'Please provide a description.' });
    }

    const gender = req.body.category === 'Guys' ? 'man' : 'woman';
    const isAnime = req.body.art_style === 'Anime';
    const desc = sanitizePrompt(req.body.description);

    const prompt = isAnime
      ? `anime character portrait, ${gender}, ${desc}, fantasy-inspired anime art, vibrant colors, detailed eyes, front facing, looking at camera`
      : `photorealistic portrait of a ${gender}, ${desc}, professional fantasy-inspired photography, 85mm lens, natural lighting, detailed skin, front facing, looking at camera, high resolution`;

    const imageBuffer = await generateWithPollinations(prompt);
    if (!imageBuffer) {
      return res.status(500).json({ error: 'Avatar generation failed. Try again or upload manually.' });
    }

    const avatarUrl = saveBuffer('gen', imageBuffer, '.png');
    return res.json({ avatar_url: avatarUrl, provider: 'pollinations' });
  } catch (err) {
    console.error('Avatar error:', err);
    return res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Fantasy scene of ${companion.name}`);

    const avatarPath = publicUrlToLocalPath(companion.avatar_url);
    if (!avatarPath || !fs.existsSync(avatarPath)) {
      await refundTokens(req.user.id, TOKEN_COSTS.image);
      return res.status(400).json({ error: 'Companion avatar is missing. Generate or upload an avatar first.' });
    }

    const scene = getRandomFantasyScene();
    const prompt = scenePromptForCompanion(companion, scene);
    const result = await img2img({
      imagePath: avatarPath,
      prompt,
      negativePrompt: DEAPI_IMAGE_NEGATIVE,
    });

    const imageUrl = saveBuffer('scene', result.buffer, '.png');

    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', imageUrl]
    );

    return res.json({
      image_url: imageUrl,
      caption: '📸',
      provider: 'deapi',
      model: result.model,
      scene,
    });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene error:', err?.body || err);
    await refundTokens(req.user.id, TOKEN_COSTS.image).catch(() => {});
    return res.status(500).json({ error: 'Fantasy image generation failed' });
  }
});

router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Fantasy video of ${companion.name}`);

    const avatarPath = publicUrlToLocalPath(companion.avatar_url);
    if (!avatarPath || !fs.existsSync(avatarPath)) {
      await refundTokens(req.user.id, TOKEN_COSTS.video);
      return res.status(400).json({ error: 'Companion avatar is missing. Generate or upload an avatar first.' });
    }

    const scene = getRandomFantasyScene();
    const sceneResult = await img2img({
      imagePath: avatarPath,
      prompt: scenePromptForCompanion(companion, scene),
      negativePrompt: DEAPI_IMAGE_NEGATIVE,
    });

    const tempScenePath = path.join(uploadDir, `vscene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
    fs.writeFileSync(tempScenePath, sceneResult.buffer);

    try {
      const videoResult = await img2video({
        imagePath: tempScenePath,
        prompt: videoPromptForCompanion(companion, scene),
        negativePrompt: DEAPI_VIDEO_NEGATIVE,
      });

      const sceneImageUrl = saveBuffer('scene', sceneResult.buffer, '.png');
      const videoUrl = saveBuffer('video', videoResult.buffer, '.mp4');

      await pool.query(
        `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
        [req.user.id, companionId, '🎬', videoUrl]
      );

      return res.json({
        video_url: videoUrl,
        scene_image_url: sceneImageUrl,
        caption: '🎬',
        provider: 'deapi',
        video_model: videoResult.model,
        image_model: sceneResult.model,
        scene,
      });
    } finally {
      try { fs.unlinkSync(tempScenePath); } catch {}
    }
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video error:', err?.body || err);
    await refundTokens(req.user.id, TOKEN_COSTS.video).catch(() => {});
    return res.status(500).json({ error: 'Fantasy video generation failed' });
  }
});

module.exports = router;
