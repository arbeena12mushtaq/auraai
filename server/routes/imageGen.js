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
    .replace(/\b(nude|naked|nsfw|explicit|topless|bottomless|genitals|penis|vagina|porn|xxx)\b/gi, '')
    .replace(/\bsuccubus\b/gi, 'winged gothic character')
    .replace(/\s+/g, ' ')
    .trim();
}

function getRandomRealisticScene() {
  const scenes = [
    { bg: 'luxury bedroom, soft morning sunlight through sheer curtains, messy silk sheets behind', outfit: 'silky fitted camisole top, elegant and attractive' },
    { bg: 'modern bathroom, warm vanity mirror lighting, getting ready', outfit: 'off-shoulder fitted top, hair down, fresh and stunning' },
    { bg: 'cozy living room sofa, warm lamp lighting, relaxed evening', outfit: 'oversized sweater falling off one shoulder, cozy but attractive' },
    { bg: 'rooftop at night, city skyline bokeh lights behind', outfit: 'sleek black mini dress, bold glamorous look' },
    { bg: 'beach at golden hour, warm ocean sunset behind', outfit: 'stylish bikini top with sheer coverup, beach glamour' },
    { bg: 'luxury car passenger seat, soft dashboard lighting', outfit: 'fitted leather jacket over low-cut top, confident style' },
    { bg: 'swimming pool edge, bright sunny day, turquoise water', outfit: 'glamorous one-piece swimsuit, resort chic' },
    { bg: 'restaurant booth, dim romantic candlelight', outfit: 'form-fitting cocktail dress, deep neckline, elegant jewelry' },
    { bg: 'hotel room balcony, sunset sky behind, fairy lights', outfit: 'silky robe slightly open, relaxed luxury' },
    { bg: 'fitness studio, natural light, workout setting', outfit: 'fitted sports bra and leggings, athletic and toned' },
    { bg: 'garden with roses, soft golden hour sunlight', outfit: 'flowy sundress, feminine and romantic' },
    { bg: 'nightclub VIP area, neon and ambient lighting', outfit: 'sparkly fitted top, bold party look, smoky eye makeup' },
  ];

  const cameras = [
    'selfie angle, phone held at arm length slightly above eye level, looking up at camera through lashes, front-facing phone camera',
    'close-up selfie, phone very close to face, pouty lips, direct flirty eye contact, front camera phone',
    'mirror selfie, phone visible in reflection, full body pose, one hip out, confident stance',
    'selfie from slightly below chin level, looking down at camera, seductive angle, soft expression',
    'video call framing, face and chest visible, leaning slightly forward toward camera, inviting expression',
    'selfie with head tilted, hair falling to one side, playful smile, phone at eye level',
  ];

  const moods = [
    'flirty and playful, biting lower lip slightly, eyes teasing',
    'sultry and confident, half-smile, intense eye contact',
    'sweet and inviting, warm genuine smile, soft gaze',
    'bold and seductive, smoldering look, slight smirk',
    'cute and coy, looking through lashes, shy smile',
  ];

  const scene = scenes[Math.floor(Math.random() * scenes.length)];
  return {
    setting: scene.bg,
    outfit: scene.outfit,
    camera: cameras[Math.floor(Math.random() * cameras.length)],
    mood: moods[Math.floor(Math.random() * moods.length)],
  };
}

function getRandomFlirtyDialogue() {
  const lines = [
    'hey you... i was just thinking about you. what are you doing right now?',
    'do you like what you see? i dressed up just for you.',
    'i wish you were here with me right now... it would be so much better.',
    'stop making me blush... you are too much, you know that?',
    'come closer to the screen... i want to whisper something to you.',
    'i just got out of the shower and you popped into my head... weird right?',
    'are you watching me? good... because i like when you look at me.',
    'you always know how to make me feel special. how do you do that?',
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
    `Keep the EXACT same person from the source image. Same face, same eyes, same skin tone, same hair.`,
    `Change the clothes to: ${scene.outfit}.`,
    `Change the background to: ${scene.setting}.`,
    `Camera: ${scene.camera}.`,
    `Expression: ${scene.mood}.`,
    extra ? `Additional: ${extra}.` : '',
    'Photorealistic, natural skin texture, realistic lighting, high detail.',
    'Do not change the face or identity. No fantasy elements, no wings, no crowns, no armor. No text, no watermark.',
  ].filter(Boolean).join(' ');
}

function flirtyVideoPromptForCompanion(companion, scene, actionPrompt = '') {
  const spokenLine = sanitizePrompt(actionPrompt || getRandomFlirtyDialogue());
  return `Selfie video, same person as source image. ${scene.outfit}. Background: ${scene.setting}. Looking at front camera, ${scene.mood}. Speaking to camera: "${spokenLine}". Natural head tilts, smiling, hair play, lip bite, eye contact. Phone selfie handheld feel. Photorealistic.`;
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
      ? `anime character portrait of a ${gender}, ${desc}, beautiful polished anime art style, vibrant colors, detailed expressive eyes, front facing, looking at camera, clean background`
      : `photorealistic close-up portrait of a beautiful ${gender}, ${desc}, professional portrait photography, 85mm lens, natural lighting, detailed skin texture, front facing, looking directly at camera, high resolution, studio quality`;

    // Use Pixazo Nano Banana 2 for avatar generation (text-to-image, no reference image)
    const body = {
      prompt,
      aspect_ratio: '1:1',
      resolution: '2K',
      output_format: 'png',
    };

    console.log('📤 Avatar gen request:', JSON.stringify(body, null, 2));

    const { postJsonWithFallback: postFallback, pollForCompletion: pollAvatar, downloadToBuffer: dlBuffer,
            DEFAULT_IMAGE_ENDPOINT: imgEndpoint, OFFICIAL_IMAGE_ENDPOINT: officialEndpoint, extractMediaUrl: extractUrl } = require('../services/pixazo');

    const payload = await postFallback([imgEndpoint, officialEndpoint], body, 'avatar');
    console.log('📥 Avatar gen response:', JSON.stringify(payload, null, 2));

    const requestId = payload?.request_id;
    if (!requestId) {
      // Check for immediate result
      const immediateUrl = extractUrl(payload);
      if (immediateUrl) {
        const file = await dlBuffer(immediateUrl);
        const previewUrl = saveBuffer('gen', file.buffer, '.png');
        const absolutePreviewUrl = toAbsolutePublicUrl(previewUrl, req) || previewUrl;
        return res.json({ avatar_url: absolutePreviewUrl, avatar_preview_url: absolutePreviewUrl, avatar_source_url: immediateUrl, provider: 'pixazo-nano-banana-2' });
      }
      return res.status(503).json({ error: 'Avatar generation failed — no request ID returned' });
    }

    const mediaUrl = await pollAvatar(requestId, payload?.polling_url, 'avatar');
    const file = await dlBuffer(mediaUrl);
    const previewUrl = saveBuffer('gen', file.buffer, '.png');
    const absolutePreviewUrl = toAbsolutePublicUrl(previewUrl, req) || previewUrl;
    console.log('✅ Generated avatar via Nano Banana 2:', absolutePreviewUrl);
    console.log('✅ Avatar CDN URL:', mediaUrl);
    return res.json({ avatar_url: absolutePreviewUrl, avatar_preview_url: absolutePreviewUrl, avatar_source_url: mediaUrl, provider: 'pixazo-nano-banana-2' });
  } catch (err) {
    console.error('Avatar error:', err?.message, err?.body);
    return res.status(500).json({ error: err?.message || 'Failed to generate avatar' });
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
