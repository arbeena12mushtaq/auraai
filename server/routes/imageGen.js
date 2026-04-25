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
  // Backgrounds only — the character stays the same, only the environment changes
  const backgrounds = [
    { bg: 'cozy coffee shop interior, warm ambient lighting, blurred cafe background', vibe: 'casual coffee date' },
    { bg: 'bedroom with soft morning sunlight through sheer curtains, cozy bed in background', vibe: 'lazy morning' },
    { bg: 'modern apartment living room, soft daylight, minimalist decor blurred behind', vibe: 'chill at home' },
    { bg: 'rooftop at night, city skyline lights bokeh in background', vibe: 'night out' },
    { bg: 'beach at golden hour, ocean waves softly blurred behind', vibe: 'beach sunset' },
    { bg: 'car interior, dashboard lights, evening drive', vibe: 'going somewhere fun' },
    { bg: 'bathroom mirror, warm vanity lighting, getting ready', vibe: 'getting ready' },
    { bg: 'garden with colorful flowers, soft natural sunlight', vibe: 'outdoor walk' },
    { bg: 'restaurant booth, dim romantic candle lighting, blurred background', vibe: 'dinner date' },
    { bg: 'gym or yoga studio, natural light, workout setting', vibe: 'active day' },
    { bg: 'balcony with fairy lights, evening sky behind', vibe: 'cozy evening' },
    { bg: 'hotel room, luxury bedding, soft warm lamp light', vibe: 'travel vibes' },
  ];

  // All cameras are selfie-style — phone held by the person, front-facing
  const cameras = [
    'selfie taken with phone held at arm length, slightly above eye level, front-facing camera, natural phone photo look',
    'close-up selfie, phone held close, face filling most of the frame, warm smile, direct eye contact with camera',
    'selfie angle from slightly above, one hand holding phone, head slightly tilted, flirty expression',
    'mirror selfie style, phone visible in reflection, casual pose, looking at phone screen',
    'video call framing, face and upper chest visible, looking directly into camera lens, phone propped up',
    'selfie with phone held at chest level, looking down at camera, soft expression, intimate angle',
  ];

  const moods = [
    'flirty and playful, slight smile, eyes inviting',
    'warm and intimate, soft gaze, gentle smile',
    'confident and teasing, one eyebrow slightly raised, smirk',
    'shy and sweet, looking through lashes, blushing',
    'relaxed and natural, genuine laugh, candid moment',
  ];

  const bg = backgrounds[Math.floor(Math.random() * backgrounds.length)];
  return {
    setting: bg.bg,
    vibe: bg.vibe,
    camera: cameras[Math.floor(Math.random() * cameras.length)],
    mood: moods[Math.floor(Math.random() * moods.length)],
  };
}

function getRandomFlirtyDialogue() {
  const lines = [
    'hey you... i was just thinking about you. what are you doing right now?',
    'okay be honest... do you like this look on me? i tried something new.',
    'i wish you were here right now... it would be so much better with you.',
    'stop making me smile like this... you are too cute, you know that?',
    'guess what... i have a surprise for you later. you will love it.',
    'hey... i just woke up and you were the first thing on my mind.',
    'come closer... i want to tell you something. are you listening?',
    'you always know how to make my day better. how do you do that?',
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
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&model=flux`;
    try {
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
            return { buffer, sourceUrl: url, seed, contentType };
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
    `IMPORTANT: Keep the EXACT same person from the source image. Same face, same eyes, same lips, same nose, same skin tone, same hair color, same hairstyle. Do NOT change the person's identity at all.`,
    `This is a selfie photo taken by ${character} on their phone camera.`,
    `Camera: ${scene.camera}.`,
    `Background: ${scene.setting}.`,
    `Expression and mood: ${scene.mood}.`,
    `The person is looking directly at the front-facing phone camera as if taking a selfie or on a video call.`,
    extra ? `Additional context: ${extra}.` : '',
    'Style: photorealistic, natural phone camera quality, slight phone camera lens distortion, realistic skin texture, natural lighting from the environment.',
    'Rules: keep the EXACT same person from the input image, only change the background and lighting. Do not change face, hair, body, or identity. No fantasy elements, no wings, no crowns, no armor. Keep fully clothed. No text, no watermark.',
  ].filter(Boolean).join(' ');
}

function flirtyVideoPromptForCompanion(companion, scene, actionPrompt = '') {
  const character = buildCharacterSummary(companion);
  const spokenLine = sanitizePrompt(actionPrompt || getRandomFlirtyDialogue());
  return [
    `IMPORTANT: Keep the EXACT same person from the source image throughout the entire video. Do not change their face, hair, or identity at all.`,
    `This is a selfie-style video of ${character} recording themselves on their front-facing phone camera.`,
    `The person is holding their phone at arm's length or has it propped up, looking directly into the camera like a video call or selfie video.`,
    `Background: ${scene.setting}.`,
    `Mood: ${scene.mood}.`,
    `The person speaks directly to the camera in a warm, flirty, natural tone, saying: "${spokenLine}".`,
    'Natural movements: subtle head tilts, genuine smiling, natural blinking, slight hair touching, soft breathing, playful eye contact with the camera.',
    'Camera feel: slight phone handheld movement, natural selfie video look, front-facing camera perspective, intimate close framing.',
    'Keep the exact same person as the source image. Ultra realistic, natural motion, no text overlays, no subtitles, no watermark, no fantasy elements, fully clothed.',
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


function toAbsolutePublicUrl(relativeOrAbsolute, req = null) {
  if (!relativeOrAbsolute) return null;
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const envBase = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const reqBase = req ? `${req.protocol}://${req.get('host')}`.replace(/\/$/, '') : '';
  const publicBase = envBase || reqBase;
  if (!publicBase) return null;
  return `${publicBase}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`;
}

function safeErrorPayload(err) {
  return {
    error: err?.body?.message || err?.body?.error || err?.message || 'Unknown error',
    status: err?.status || 500,
    details: err?.body || null,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
  };
}

async function checkPublicImageUrl(url) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { accept: 'image/*,*/*;q=0.8' } });
    const contentType = res.headers.get('content-type') || '';
    return { ok: res.ok, status: res.status, contentType };
  } catch (err) {
    return { ok: false, status: 0, contentType: '', error: err.message };
  }
}

async function createSceneFromAvatar(companion, userPrompt = '', req = null) {
  const avatarUrl = toAbsolutePublicUrl(companion.avatar_url, req);
  if (!avatarUrl) {
    throw new Error('Companion avatar is missing or PUBLIC_BASE_URL / APP_BASE_URL is not configured.');
  }

  const probe = await checkPublicImageUrl(avatarUrl);
  console.log('🧪 Avatar URL probe:', probe);
  if (!probe.ok) {
    const e = new Error(`Avatar URL is not publicly reachable (${probe.status || 'network error'})`);
    e.body = probe;
    throw e;
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

    const previewUrl = saveBuffer('gen', imageBuffer.buffer, '.png');
    const absolutePreviewUrl = toAbsolutePublicUrl(previewUrl, req) || previewUrl;
    console.log('✅ Generated avatar preview URL:', absolutePreviewUrl);
    console.log('✅ Generated avatar source URL:', imageBuffer.sourceUrl);
    return res.json({ avatar_url: absolutePreviewUrl, avatar_preview_url: absolutePreviewUrl, avatar_source_url: imageBuffer.sourceUrl, provider: 'pollinations', seed: imageBuffer.seed });
  } catch (err) {
    console.error('Avatar error:', err);
    return res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// ===== In-memory job tracking for async generation =====
const activeJobs = new Map();

function createJob(userId, companionId, type) {
  const jobId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id: jobId, userId, companionId, type, status: 'processing', startedAt: Date.now(), result: null, error: null };
  activeJobs.set(jobId, job);
  // Auto-cleanup after 10 minutes
  setTimeout(() => activeJobs.delete(jobId), 10 * 60 * 1000);
  return job;
}

// Poll endpoint — frontend checks this for job completion
router.get('/job/:jobId', authMiddleware, (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  if (job.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (job.status === 'completed') {
    activeJobs.delete(job.id);
    return res.json({ status: 'completed', ...job.result });
  }
  if (job.status === 'failed') {
    activeJobs.delete(job.id);
    return res.status(500).json({ status: 'failed', error: job.error });
  }
  return res.json({ status: 'processing', elapsed: Date.now() - job.startedAt });
});

router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId, prompt: userPrompt } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Realistic scene of ${companion.name}`);

    // Create a job and return immediately so the frontend doesn't time out
    const job = createJob(req.user.id, companionId, 'image');
    res.json({ jobId: job.id, status: 'processing' });

    // Process in background (DO NOT await in the request handler)
    (async () => {
      try {
        const { scene, result, avatarUrl } = await createSceneFromAvatar(companion, userPrompt || req.body.context || '', req);
        console.log('🖼️ Scene source avatar URL:', avatarUrl);
        console.log('🖼️ Scene image bytes:', result?.buffer?.length || 0);

        // Always prefer the external CDN URL (survives Railway redeploys)
        const persistentImageUrl = result?.sourceUrl;
        let fallbackUrl = null;
        if (!persistentImageUrl) {
          const cachedImagePath = saveBuffer('scene', result.buffer, '.png');
          fallbackUrl = toAbsolutePublicUrl(cachedImagePath, req) || cachedImagePath;
        }
        const finalImageUrl = persistentImageUrl || fallbackUrl;
        console.log('🖼️ Final persistent image URL:', finalImageUrl);

        await pool.query(
          `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
          [req.user.id, companionId, '📸', finalImageUrl]
        );

        job.status = 'completed';
        job.result = {
          success: true,
          image_url: finalImageUrl,
          imageUrl: finalImageUrl,
          caption: '📸',
          provider: 'pixazo-runway',
          model: result.model,
          scene,
          mode: 'realistic_scene',
        };
        console.log('✅ Scene job completed:', job.id);
      } catch (err) {
        console.error('Scene job error:', { jobId: job.id, message: err?.message, status: err?.status, body: err?.body || null });
        job.status = 'failed';
        job.error = err?.message || 'Image generation failed';
        // Refund tokens on failure
        await refundTokens(req.user.id, TOKEN_COSTS.image).catch(() => {});
      }
    })();

  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene error:', { message: err?.message, status: err?.status, body: err?.body || null, stack: err?.stack });
    await refundTokens(req.user.id, TOKEN_COSTS.image).catch(() => {});
    return res.status(500).json(safeErrorPayload(err));
  }
});

router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId, prompt: userPrompt, actionPrompt } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Talking realistic video of ${companion.name}`);

    // Create a job and return immediately
    const job = createJob(req.user.id, companionId, 'video');
    res.json({ jobId: job.id, status: 'processing' });

    // Process in background
    (async () => {
      try {
        const { scene, result: sceneResult, avatarUrl } = await createSceneFromAvatar(companion, userPrompt || req.body.context || '', req);
        console.log('🎞️ Video source avatar URL:', avatarUrl);

        // Prefer the Pixazo CDN URL for the scene image — Runway fetches from CDN much more reliably
        // than from our Railway instance (which may be slow or behind a proxy)
        let sceneImageForRunway = sceneResult?.sourceUrl;
        if (!sceneImageForRunway) {
          // Fallback to local if no CDN URL (shouldn't happen with Nano Banana 2)
          const sceneImageUrl = saveBuffer('scene', sceneResult.buffer, '.png');
          sceneImageForRunway = toAbsolutePublicUrl(sceneImageUrl, req);
        }
        if (!sceneImageForRunway) {
          throw new Error('Could not build a public scene image URL for video generation');
        }
        console.log('🎞️ Runway scene image URL:', sceneImageForRunway);

        const videoResult = await imageToVideo({
          imageUrl: sceneImageForRunway,
          prompt: flirtyVideoPromptForCompanion(companion, scene, actionPrompt),
        });

        // Always prefer the external CDN URL
        const persistentVideoUrl = videoResult?.sourceUrl;
        let fallbackUrl = null;
        if (!persistentVideoUrl) {
          const cachedVideoPath = saveBuffer('video', videoResult.buffer, '.mp4');
          fallbackUrl = toAbsolutePublicUrl(cachedVideoPath, req) || cachedVideoPath;
        }
        const finalVideoUrl = persistentVideoUrl || fallbackUrl;
        console.log('🎞️ Final persistent video URL:', finalVideoUrl);

        await pool.query(
          `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
          [req.user.id, companionId, '🎬', finalVideoUrl]
        );

        job.status = 'completed';
        job.result = {
          success: true,
          video_url: finalVideoUrl,
          videoUrl: finalVideoUrl,
          caption: '🎬',
          provider: 'pixazo-runway',
          video_model: videoResult.model,
          image_model: sceneResult.model,
          scene,
          mode: 'talking_flirty',
        };
        console.log('✅ Video job completed:', job.id);
      } catch (err) {
        console.error('Video job error:', { jobId: job.id, message: err?.message, status: err?.status, body: err?.body || null });
        job.status = 'failed';
        job.error = err?.message || 'Video generation failed';
        await refundTokens(req.user.id, TOKEN_COSTS.video).catch(() => {});
      }
    })();

  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video error:', { message: err?.message, status: err?.status, body: err?.body || null, stack: err?.stack });
    await refundTokens(req.user.id, TOKEN_COSTS.video).catch(() => {});
    return res.status(500).json(safeErrorPayload(err));
  }
});


module.exports = router;
