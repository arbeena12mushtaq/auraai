const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { imageToImage, imageToVideo } = require('../services/pixazo');

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

function getRandomRealisticScene() {
  const scenes = [
    { setting: 'luxury bedroom with warm lamp light and elegant decor', outfit: 'stylish fitted evening dress with glamorous styling' },
    { setting: 'cozy coffee shop by the window with golden hour light', outfit: 'chic body-skimming dress with a modern fashionable look' },
    { setting: 'modern apartment living room with soft daylight', outfit: 'sleek fitted lounge set styled in a polished attractive way' },
    { setting: 'rooftop lounge with city lights at night', outfit: 'black cocktail dress with bold elegant fashion styling' },
    { setting: 'ocean-view balcony at sunset with warm breeze', outfit: 'luxury resort outfit with refined glamorous styling' },
    { setting: 'high-end restaurant with candlelight ambiance', outfit: 'elegant satin dress with sophisticated evening styling' },
  ];

  const cameras = [
    'medium close-up, eye-level framing, shallow depth of field, looking into camera',
    'selfie-style framing, slight high angle, natural phone-camera perspective',
    'waist-up portrait, slight 3/4 angle, cinematic depth of field',
    'close-up portrait, subtle side angle, soft focus background, intimate framing',
  ];

  const moods = [
    'playful and charming',
    'confident and flirty',
    'warm and teasing',
    'soft and inviting',
  ];

  const scene = scenes[Math.floor(Math.random() * scenes.length)];
  return {
    ...scene,
    camera: cameras[Math.floor(Math.random() * cameras.length)],
    mood: moods[Math.floor(Math.random() * moods.length)],
  };
}

function getRandomFlirtyDialogue() {
  const lines = [
    'hey... you showed up right on time. were you thinking about me?',
    'you have that look again... are you going to say something, or just keep staring?',
    'mmm, you seem interesting today. tell me what is on your mind.',
    'i like your timing... you always appear when things are getting fun.',
    'come on, talk to me... i want to hear what made you open this chat.',
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

async function generateWithPollinations(prompt, width = 1024, height = 1024) {
  const attempts = Number(process.env.POLLINATIONS_RETRIES || 3);
  const timeoutMs = Number(process.env.POLLINATIONS_TIMEOUT_MS || 45000);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const seed = Math.floor(Math.random() * 999999);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&model=flux`;
      console.log(`🌸 Pollinations avatar attempt ${attempt}/${attempts} (seed:${seed})...`);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'image/*,*/*;q=0.8',
          'user-agent': 'AuraAI/1.0',
        },
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        console.error(`Pollinations failed on attempt ${attempt}:`, res.status, bodyText.slice(0, 200));
      } else {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('image')) {
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length >= 3000) {
            clearTimeout(timer);
            return buffer;
          }
          console.error(`Pollinations returned too-small image on attempt ${attempt}:`, buffer.length);
        } else {
          const bodyText = await res.text().catch(() => '');
          console.error(`Pollinations returned non-image on attempt ${attempt}:`, contentType, bodyText.slice(0, 200));
        }
      }
    } catch (err) {
      console.error(`Pollinations error on attempt ${attempt}:`, err.message);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
    }
  }

  return null;
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
  const gender = companion.category === 'Guys' ? 'man' : 'woman';
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

function scenePromptForCompanion(companion, scene, userPrompt = '') {
  const character = buildCharacterSummary(companion);
  const extra = sanitizePrompt(userPrompt || '');

  return [
    `Use the uploaded avatar as the identity anchor for ${character}.`,
    'Keep the same face, hairstyle, skin tone, facial proportions, and overall identity exactly consistent with the source avatar.',
    `Background: ${scene.setting}.`,
    `Wardrobe: ${scene.outfit}.`,
    `Camera framing: ${scene.camera}.`,
    `Mood: ${scene.mood}.`,
    extra ? `Additional styling request: ${extra}.` : '',
    'Style: photorealistic, natural skin texture, cinematic lighting, realistic smartphone or DSLR portrait photography, modern lifestyle aesthetic.',
    'Important rules: adult-looking subject only, fully clothed, no nudity, no fantasy effects, no text, no watermark.',
  ].filter(Boolean).join(' ');
}

function flirtyVideoPromptForCompanion(companion, scene, actionPrompt = '') {
  const character = buildCharacterSummary(companion);
  const spokenLine = sanitizePrompt(actionPrompt || getRandomFlirtyDialogue());
  return [
    `Create a highly realistic live-action talking video of ${character}.`,
    `She is in this setting: ${scene.setting}.`,
    `Her outfit is: ${scene.outfit}.`,
    `Shot style: ${scene.camera}.`,
    `Emotion: ${scene.mood}.`,
    `She speaks directly to camera and says in a playful, flirty, natural tone: "${spokenLine}".`,
    'Include realistic lip sync, natural blinking, subtle head tilts, soft breathing, slight smile changes, engaging eye contact, and gentle flirtatious body language.',
    'Use camera motion like a slow push-in, slight handheld drift, tiny framing adjustments, and a natural phone-video feel.',
    'Keep the exact same identity as the source avatar and first frame throughout the full video.',
    'Ultra realistic, natural motion, clean audio in the video, no subtitles, no text, no watermark, no fantasy elements, fully clothed adult-looking subject only.',
  ].join(' ');
}

function extFromContentType(contentType, fallback = '.bin') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3';
  if (type.includes('wav')) return '.wav';
  if (type.includes('ogg')) return '.ogg';
  if (type.includes('flac')) return '.flac';
  if (type.includes('mp4')) return '.mp4';
  if (type.includes('png')) return '.png';
  return fallback;
}

async function createSceneFromAvatar(companion, userPrompt = '') {
  const avatarPath = publicUrlToLocalPath(companion.avatar_url);
  if (!avatarPath || !fs.existsSync(avatarPath)) {
    throw new Error('Companion avatar is missing. Generate or upload an avatar first.');
  }

  const scene = getRandomRealisticScene();
  const result = await imageToImage({
    imagePath: avatarPath,
    prompt: scenePromptForCompanion(companion, scene, userPrompt),
  });

  return { avatarPath, scene, result };
}

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    if (!req.body.description?.trim()) {
      return res.status(400).json({ error: 'Please provide a description.' });
    }

    const gender = req.body.category === 'Guys' ? 'man' : 'woman';
    const isAnime = req.body.art_style === 'Anime';
    const desc = sanitizePrompt(req.body.description);

    const prompt = isAnime
      ? `anime character portrait, ${gender}, ${desc}, polished anime art, vibrant colors, detailed eyes, front facing, looking at camera`
      : `photorealistic portrait of a ${gender}, ${desc}, professional portrait photography, 85mm lens, natural lighting, detailed skin, front facing, looking at camera, high resolution`;

    const imageBuffer = await generateWithPollinations(prompt);
    if (!imageBuffer) {
      return res.status(503).json({ error: 'Avatar generation provider is temporarily unavailable. Please try again in a moment.' });
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
    const { companionId, prompt: userPrompt } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Realistic scene of ${companion.name}`);

    const { scene, result } = await createSceneFromAvatar(companion, userPrompt);
    const imageUrl = saveBuffer('scene', result.buffer, '.png');

    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', imageUrl]
    );

    return res.json({
      image_url: imageUrl,
      caption: '📸',
      provider: 'pixazo',
      model: result.model,
      scene,
      mode: 'realistic_scene',
    });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene error:', { message: err?.message, status: err?.status, body: err?.body || null, stack: err?.stack });
    await refundTokens(req.user.id, TOKEN_COSTS.image).catch(() => {});
    return res.status(500).json({ error: err?.body?.message || err?.message || 'Realistic image generation failed' });
  }
});

async function generateFlirtyVideo(req, res) {
  const { companionId, prompt: userPrompt, actionPrompt } = req.body;
  if (!companionId) return res.status(400).json({ error: 'companionId required' });

  const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
  if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
  const companion = comp.rows[0];

  await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Flirty talking video of ${companion.name}`);

  const { scene, result: sceneResult } = await createSceneFromAvatar(companion, userPrompt);
  const tempScenePath = path.join(uploadDir, `vscene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  fs.writeFileSync(tempScenePath, sceneResult.buffer);

  try {
    const publicBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
    if (!publicBaseUrl) throw new Error('PUBLIC_BASE_URL or APP_BASE_URL is required for Pixazo video generation');

    const sceneImageUrl = saveBuffer('scene', sceneResult.buffer, '.png');
    const absoluteSceneUrl = `${publicBaseUrl}${sceneImageUrl}`;

    const videoResult = await imageToVideo({
      imageUrl: absoluteSceneUrl,
      prompt: flirtyVideoPromptForCompanion(companion, scene, actionPrompt),
    });

    const videoUrl = saveBuffer('video', videoResult.buffer, '.mp4');

    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
      [req.user.id, companionId, '🎬', videoUrl]
    );

    return res.json({
      video_url: videoUrl,
      scene_image_url: sceneImageUrl,
      caption: '🎬',
      provider: 'pixazo',
      video_model: videoResult.model,
      image_model: sceneResult.model,
      scene,
      mode: 'flirty_talking_video',
      has_audio: true,
      music: false,
    });
  } finally {
    try { fs.unlinkSync(tempScenePath); } catch {}
  }
}


router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    return await generateFlirtyVideo(req, res);
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video error:', { message: err?.message, status: err?.status, body: err?.body || null, stack: err?.stack });
    await refundTokens(req.user.id, TOKEN_COSTS.video).catch(() => {});
    return res.status(500).json({ error: err?.body?.message || err?.message || 'Talking video generation failed' });
  }
});


module.exports = router;
