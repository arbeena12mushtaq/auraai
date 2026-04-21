const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const {
  assertConfigured,
  submitTxt2Img,
  submitImg2Img,
  waitForResult,
  downloadResultToFile,
} = require('../services/deapi');
const {
  assertPollinationsConfigured,
  generateVideoToFile,
} = require('../services/pollinations');

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
    .replace(/\bfantasy\b/gi, '')
    .replace(/\bsuccubus\b/gi, 'winged gothic woman')
    .replace(/\s+/g, ' ')
    .trim();
}

function getRandomScene() {
  const scenes = [
    { setting: 'enchanted forest with glowing trees, floating fireflies, moonlit fog, magical fantasy atmosphere', outfit: 'ornate elven gown with silver embroidery and flowing cape' },
    { setting: 'ancient castle balcony above the clouds, stormy sky, fantasy kingdom in the distance', outfit: 'regal fantasy queen attire with jeweled crown and velvet cloak' },
    { setting: 'mystic crystal cave lit by blue runes and glowing gemstones, cinematic fantasy world', outfit: 'arcane sorcerer robes with luminous details and elegant gloves' },
    { setting: 'dragon temple courtyard with giant statues, burning braziers, epic fantasy setting', outfit: 'warrior-princess armor with polished metal accents and flowing fabric' },
    { setting: 'celestial garden with floating lanterns, waterfalls, soft golden magic particles', outfit: 'ethereal goddess dress with sheer layers and celestial jewelry' },
    { setting: 'snow-covered fantasy village under the northern lights, magical winter atmosphere', outfit: 'luxurious fur-lined fantasy cloak over royal embroidered clothing' },
    { setting: 'desert palace at sunset with giant moon, ancient arches, mystical fantasy vibe', outfit: 'ornate desert empress costume with gold accessories and silk veil' },
    { setting: 'haunted gothic throne room with candles, stained glass, dark fantasy ambiance', outfit: 'dark royal gothic attire with dramatic high collar and elegant details' }
  ];

  const cameras = [
    'cinematic close-up portrait, eyes locked to camera, shallow depth of field',
    'medium hero shot from waist up, dramatic fantasy pose, rich background detail',
    'full-body epic fantasy shot, centered composition, powerful posture',
    'slight low-angle hero framing, cinematic perspective, majestic mood',
    'three-quarter portrait shot, soft magical rim light, elegant pose',
    'walking toward camera in slow cinematic style, flowing outfit movement',
    'over-the-shoulder turn toward camera, dramatic fantasy reveal',
    'portrait shot with subtle wind in hair and clothing, cinematic storytelling'
  ];

  const chosenScene = scenes[Math.floor(Math.random() * scenes.length)];
  const chosenCamera = cameras[Math.floor(Math.random() * cameras.length)];

  return {
    setting: chosenScene.setting,
    outfit: chosenScene.outfit,
    camera: chosenCamera,
  };
}

function localPathFromAvatarUrl(avatarUrl) {
  if (!avatarUrl) return null;

  if (avatarUrl.startsWith('/uploads/')) {
    return path.join(uploadDir, path.basename(avatarUrl));
  }

  return path.join(uploadDir, path.basename(avatarUrl));
}

async function saveRemoteResult(resultUrl, prefix, ext) {
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fullPath = path.join(uploadDir, filename);
  await downloadResultToFile(resultUrl, fullPath);
  return { filename, url: `/uploads/${filename}`, fullPath };
}

function buildAvatarPrompt({ description, category, artStyle }) {
  const gender = category === 'Guys' ? 'man' : 'woman';
  const safeDescription = sanitizePrompt(description);

  if (artStyle === 'Anime') {
    return `anime character portrait, ${gender}, ${safeDescription}, anime art, vibrant colors, detailed eyes, front facing, looking at camera`;
  }

  return `photorealistic portrait of a ${gender}, ${safeDescription}, professional photography, 85mm lens, natural lighting, detailed skin, front facing, looking at camera, high resolution`;
}

function buildSceneEditPrompt(companion, setting, outfit, camera) {
  const gender = companion.category === 'Guys' ? 'man' : 'woman';
  const desc = sanitizePrompt(companion.description || companion.tagline || companion.name || 'portrait subject');
  return `Edit this exact ${gender}. Keep the same identity, same face, same hair, same eye color, and same overall appearance. Place them in ${setting}. Change outfit to ${outfit}. Camera framing: ${camera}. Maintain photorealistic editorial quality. Character details: ${desc}.`;
}

function buildVideoMotionPrompt(companion) {
  const gender = companion.category === 'Guys' ? 'man' : 'woman';
  return `A ${gender} with subtle natural motion, realistic blinking, slight head movement, gentle expression changes, cinematic realism, stable face, no distortion.`;
}
function buildFantasyVideoPrompt(companion, setting, outfit, camera, context = '') {
  const gender = companion.category === 'Guys' ? 'man' : 'woman';
  const desc = sanitizePrompt(companion.description || companion.tagline || companion.name || 'fantasy character');
  const extraContext = context ? ` Story context: ${sanitizePrompt(context).slice(0, 220)}.` : '';
  return `Cinematic fantasy video of the same ${gender} character named ${companion.name || 'Nand'}. Keep the same face, hair, eye color, body type, and signature identity throughout the clip. Character details: ${desc}. Outfit: ${outfit}. Setting: ${setting}. Framing: ${camera}. The character should have subtle lifelike motion, blinking, gentle head turns, flowing clothing, magical particles, and rich fantasy atmosphere.${extraContext} High detail, consistent character, stable face, no extra limbs, no distortion, no text, no watermark.`;
}

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    assertConfigured();

    if (!req.body.description?.trim()) {
      return res.status(400).json({ error: 'Please provide a description.' });
    }

    const prompt = buildAvatarPrompt({
      description: req.body.description,
      category: req.body.category,
      artStyle: req.body.art_style,
    });

    console.log('🎨 deAPI avatar prompt:', prompt);

    const { requestId, model } = await submitTxt2Img({
      prompt,
      width: 1024,
      height: 1024,
      guidance: req.body.art_style === 'Anime' ? 6 : 4,
      steps: req.body.art_style === 'Anime' ? 12 : 8,
      seed: parseInt(req.body.avatar_seed, 10) || undefined,
    });

    const result = await waitForResult(requestId, { timeoutMs: 180000, intervalMs: 3500 });
    const saved = await saveRemoteResult(result.resultUrl, 'gen', 'png');

    console.log(`✅ Avatar saved: ${saved.filename} (model: ${model})`);
    res.json({ avatar_url: saved.url, provider: `deapi:${model}`, request_id: requestId });
  } catch (err) {
    console.error('Avatar generation error:', err?.payload || err);
    if (err.code === 'DEAPI_NOT_CONFIGURED') {
      return res.status(500).json({ error: 'deAPI is not configured on the server. Add DEAPI_API_KEY.' });
    }
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    assertConfigured();

    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    const avatarPath = localPathFromAvatarUrl(companion.avatar_url);
    if (!avatarPath || !fs.existsSync(avatarPath)) {
      return res.status(400).json({ error: 'Companion avatar image not found. Recreate or upload avatar first.' });
    }

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    const { setting, outfit, camera } = getRandomScene();
    const prompt = buildSceneEditPrompt(companion, setting, outfit, camera);

    console.log('📸 deAPI scene prompt:', prompt);

    const { requestId, model } = await submitImg2Img({
      prompt,
      imagePath: avatarPath,
      width: 1024,
      height: 1024,
      guidance: 5,
      steps: 18,
      seed: companion.avatar_seed || undefined,
    });

    const result = await waitForResult(requestId, { timeoutMs: 180000, intervalMs: 3500 });
    const saved = await saveRemoteResult(result.resultUrl, 'scene', 'png');

    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', saved.url]
    );

    console.log(`✅ Scene saved: ${saved.filename} (model: ${model})`);
    res.json({ image_url: saved.url, caption: '📸', provider: `deapi:${model}`, request_id: requestId });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene generation error:', err?.payload || err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    assertConfigured();

    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    const avatarPath = localPathFromAvatarUrl(companion.avatar_url);
    if (!avatarPath || !fs.existsSync(avatarPath)) {
      return res.status(400).json({ error: 'Companion avatar image not found. Recreate or upload avatar first.' });
    }

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    assertPollinationsConfigured();

    const { setting, outfit, camera } = getRandomScene();
    const videoPrompt = buildFantasyVideoPrompt(companion, setting, outfit, camera, req.body.context || '');

    const scenePrompt = buildSceneEditPrompt(companion, setting, outfit, camera);
    const sceneJob = await submitImg2Img({
      prompt: scenePrompt,
      imagePath: avatarPath,
      width: 1024,
      height: 1024,
      guidance: 5,
      steps: 18,
      seed: companion.avatar_seed || undefined,
    });

    const sceneResult = await waitForResult(sceneJob.requestId, { timeoutMs: 180000, intervalMs: 3500 });
    const sceneSaved = await saveRemoteResult(sceneResult.resultUrl, 'vscene', 'png');

    const videoFilename = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const videoPath = path.join(uploadDir, videoFilename);
    const videoJob = await generateVideoToFile({
      prompt: videoPrompt,
      outputPath: videoPath,
      width: 720,
      height: 1280,
      seed: parseInt(companion.avatar_seed, 10) || undefined,
      duration: 5,
      enhance: true,
      safe: false,
      negativePrompt: 'blurry, distorted face, duplicate person, extra limbs, watermark, text, low quality',
    });

    const videoSaved = {
      filename: videoFilename,
      url: `/uploads/${videoFilename}`,
      fullPath: videoPath,
    };

    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
      [req.user.id, companionId, '🎬', videoSaved.url]
    );

    console.log(`✅ Video saved: ${videoSaved.filename} (scene: ${sceneJob.model}, video: ${videoJob.model})`);
    res.json({
      video_url: videoSaved.url,
      scene_image_url: sceneSaved.url,
      caption: '🎬',
      provider: `pollinations:${videoJob.model}`,
      source_url: videoJob.sourceUrl,
    });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video generation error:', err?.payload || err);
    if (err.code === 'POLLINATIONS_NOT_CONFIGURED') {
      return res.status(500).json({ error: 'Pollinations is not configured on the server. Add POLLINATIONS_API_KEY.' });
    }
    res.status(500).json({ error: 'Video generation failed' });
  }
});

module.exports = router;
