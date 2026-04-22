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
    { setting: 'cozy coffee shop, warm lighting, sitting by window', outfit: 'elegant mini dress, stylish modern look' },
    { setting: 'beach during golden hour, ocean behind', outfit: 'luxury beachwear, flowing wrap, modern fashion look' },
    { setting: 'modern apartment, soft daylight, on sofa', outfit: 'silky fitted loungewear, chic and attractive' },
    { setting: 'rooftop restaurant, city lights, night', outfit: 'sleek black cocktail dress, bold and glamorous' },
    { setting: 'garden with flowers, soft sunlight', outfit: 'light romantic dress, feminine and elegant' },
    { setting: 'park in autumn, golden leaves', outfit: 'form-fitting leather jacket and stylish skirt, confident fashion look' },
    { setting: 'bedroom, morning sunlight through curtains', outfit: 'luxury satin robe over stylish sleepwear' },
    { setting: 'cobblestone street at sunset, European city', outfit: 'fitted designer dress, fashionable and captivating' },
    { setting: 'swimming pool area, sunny day', outfit: 'luxury resort wear, glamorous and confident' },
    { setting: 'kitchen cooking, natural window light', outfit: 'cute fitted apron over stylish dress' },
    { setting: 'balcony overlooking ocean, soft evening light', outfit: 'off-shoulder fitted top and sleek skirt, elegant fashion style' },
    { setting: 'luxury car interior, leather seats', outfit: 'bold high-fashion outfit, fitted blazer with glamorous styling' },
  ];

  const cameras = [
    'close-up portrait, face filling frame, shallow depth of field, looking at camera',
    'medium shot from chest up, 3/4 angle view, natural pose',
    'selfie angle, phone held at arm length, slightly above eye level, front facing',
    'candid side profile, natural moment, soft focus background',
    'sitting pose, shot from slightly above, relaxed and natural',
    'leaning against wall, upper body focus, casual cool pose',
    'close-up selfie, slightly tilted head, warm expression',
    'waist-up portrait, eye level camera, realistic photography',
  ];

  const moods = [
    'confident and flirty',
    'warm and charming',
    'casual and stylish',
    'playful and inviting',
    'soft and romantic',
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
    `Keep the same woman and exact identity from the source avatar of ${character}.`,
    'Preserve the same face, eyes, lips, nose, skin tone, hairstyle, and expression as closely as possible.',
    `Place her in this realistic scene: ${scene.setting}.`,
    `Outfit: ${scene.outfit}.`,
    `Camera framing: ${scene.camera}.`,
    `Mood: ${scene.mood}.`,
    extra ? `Additional request: ${extra}.` : '',
    'Style: photorealistic, realistic lighting, natural skin texture, modern lifestyle photography, high detail.',
    'Important rules: do not turn it into fantasy art, do not add wings, throne, castle, crown, armor, or magical effects, keep it fully clothed, no text, no watermark.',
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


function toAbsolutePublicUrl(relativeOrAbsolute) {
  if (!relativeOrAbsolute) return null;
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const publicBase = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (!publicBase) return null;
  return `${publicBase}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`;
}

async function createSceneFromAvatar(companion, userPrompt = '') {
  const avatarUrl = toAbsolutePublicUrl(companion.avatar_url);
  if (!avatarUrl) {
    throw new Error('Companion avatar is missing or PUBLIC_BASE_URL / APP_BASE_URL is not configured.');
  }

  const scene = getRandomRealisticScene();
  const result = await imageToImage({
    imageUrl: avatarUrl,
    prompt: scenePromptForCompanion(companion, scene, userPrompt),
  });

  return { avatarUrl, scene, result };
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
      provider: 'pixazo-runway',
      model: result.model,
      scene,
      mode: 'realistic_scene',
    });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene error:', { message: err?.message, status: err?.status, body: err?.body || null, stack: err?.stack });
    await refundTokens(req.user.id, TOKEN_COSTS.image).catch(() => {});
    return res.status(500).json({ error: err?.body?.message || err?.body?.error || err?.message || 'Realistic image generation failed' });
  }
});

async function generateFlirtyVideo(req, res) {
  const { companionId, prompt: userPrompt, actionPrompt } = req.body;
  if (!companionId) return res.status(400).json({ error: 'companionId required' });

  const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
  if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
  const companion = comp.rows[0];

  await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Talking realistic video of ${companion.name}`);

  const { scene, result: sceneResult } = await createSceneFromAvatar(companion, userPrompt);
  const tempScenePath = path.join(uploadDir, `vscene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  fs.writeFileSync(tempScenePath, sceneResult.buffer);

  try {
    const sceneImageUrl = saveBuffer('scene', sceneResult.buffer, '.png');
    const publicBase = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
    if (!publicBase) {
      throw new Error('PUBLIC_BASE_URL or APP_BASE_URL is required for Pixazo video generation');
    }
    const absoluteSceneUrl = `${publicBase}${sceneImageUrl}`;

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
      provider: 'pixazo-runway',
      video_model: videoResult.model,
      image_model: sceneResult.model,
      scene,
      mode: 'talking_flirty',
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
    return res.status(500).json({ error: err?.body?.message || err?.body?.error || err?.message || 'Realistic video generation failed' });
  }
});


module.exports = router;
