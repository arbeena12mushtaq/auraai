const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const TOKEN_COSTS = { image: 5, video: 15 };

// ===== Helpers =====

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

function getPublicUrl(req) {
  return process.env.CLIENT_URL || `https://${req.headers.host}`;
}

function getRandomScene() {
  const settings = [
    'at a cozy coffee shop, warm lighting, sitting by window',
    'at the beach during golden hour, ocean waves behind',
    'in a modern apartment, on a sofa, soft daylight',
    'at a rooftop restaurant, city lights behind, night',
    'in a garden with flowers, soft sunlight',
    'at a park in autumn, golden leaves, warm light',
    'in a bedroom, morning sunlight through curtains',
    'on a cobblestone street at sunset, European city',
    'by a pool, turquoise water, sunny day',
    'in a kitchen cooking, natural window light',
    'at a gym, sporty pose, bright lighting',
    'on a balcony overlooking ocean, sunset sky',
    'in a luxury car, leather seats, cinematic light',
    'at a festival, colorful lights in background',
  ];
  const outfits = [
    'casual dress', 'fitted top and jeans', 'cozy sweater',
    'summer sundress', 'crop top and skirt', 'elegant evening wear',
    'silk blouse and trousers', 'athletic wear', 'leather jacket outfit',
    'off-shoulder top', 'designer outfit', 'blazer and pants',
  ];
  return {
    setting: settings[Math.floor(Math.random() * settings.length)],
    outfit: outfits[Math.floor(Math.random() * outfits.length)],
  };
}

// ===== Pollinations.ai — FREE, no API key =====
// Supports &image= param for character reference consistency

async function generateWithPollinations(prompt, width = 1024, height = 1024, seed = null, referenceImageUrl = null) {
  try {
    const usedSeed = seed || Math.floor(Math.random() * 999999);
    const encodedPrompt = encodeURIComponent(prompt);
    let url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${usedSeed}&nologo=true&enhance=true&model=flux`;

    // If reference image URL provided, add it for character consistency
    if (referenceImageUrl) {
      url += `&image=${encodeURIComponent(referenceImageUrl)}`;
      console.log('🌸 Pollinations with reference image for consistency');
    } else {
      console.log('🌸 Pollinations text-to-image');
    }

    const res = await fetch(url, { timeout: 60000 });
    if (!res.ok) { console.error('Pollinations error:', res.status); return null; }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) { console.error('Pollinations: not image'); return null; }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 5000) { console.error('Pollinations: too small'); return null; }

    console.log(`✅ Pollinations image (${Math.round(buffer.length / 1024)}KB, seed:${usedSeed})`);
    return { buffer, seed: usedSeed };
  } catch (err) { console.error('Pollinations error:', err.message); return null; }
}

// ===== DALL-E fallback =====

async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    console.log('🎨 DALL-E fallback...');
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt + '. Tasteful, appropriate, fully clothed, professional photo.',
        n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json',
      }),
    });
    if (!res.ok) { console.error('DALL-E error:', res.status); return null; }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    console.log('✅ DALL-E image generated');
    return { buffer: Buffer.from(b64, 'base64'), seed: 0 };
  } catch (err) { console.error('DALL-E error:', err.message); return null; }
}

// ===== Pixverse Video (free daily credits) =====

async function generateVideoWithPixverse(imageFilePath, prompt) {
  const apiKey = process.env.PIXVERSE_API_KEY;
  if (!apiKey) { console.log('⚠️ No PIXVERSE_API_KEY'); return null; }

  try {
    console.log('🎬 Pixverse: uploading image...');

    const fullPath = path.join(uploadDir, path.basename(imageFilePath));
    if (!fs.existsSync(fullPath)) { console.error('Pixverse: file not found'); return null; }

    // Upload using file stream (form-data with actual file)
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('image', fs.createReadStream(fullPath));

    const uploadRes = await fetch('https://app-api.pixverse.ai/openapi/v2/image/upload', {
      method: 'POST',
      headers: {
        'API-KEY': apiKey,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('Pixverse upload error:', uploadRes.status, errText.substring(0, 200));
      return null;
    }

    const uploadData = await uploadRes.json();
    console.log('Pixverse upload response:', JSON.stringify(uploadData).substring(0, 200));
    const imgId = uploadData.Resp?.img_id || uploadData.Resp?.id;
    if (!imgId) { console.error('Pixverse: no img_id'); return null; }

    console.log(`🎬 Pixverse uploaded, img_id: ${imgId}`);

    // Generate video
    const genRes = await fetch('https://app-api.pixverse.ai/openapi/v2/video/img/generate', {
      method: 'POST',
      headers: { 'API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duration: 5, img_id: imgId, model: 'v5.6',
        motion_mode: 'normal', quality: '540p',
        prompt: prompt || 'gentle smile, subtle movement',
        negative_prompt: 'fast motion, distortion, blur',
      }),
    });

    if (!genRes.ok) {
      console.error('Pixverse gen error:', genRes.status, (await genRes.text()).substring(0, 200));
      return null;
    }

    const genData = await genRes.json();
    const videoId = genData.Resp?.id;
    if (!videoId) { console.error('Pixverse: no video id'); return null; }

    console.log(`🎬 Pixverse generating video, id: ${videoId}`);

    // Poll (max 2 min)
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const pollRes = await fetch(`https://app-api.pixverse.ai/openapi/v2/video/${videoId}`, {
          headers: { 'API-KEY': apiKey },
        });
        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        const v = pollData.Resp;
        if (v?.status === 1 && v?.url) {
          console.log('✅ Pixverse video done');
          const dlRes = await fetch(v.url);
          if (dlRes.ok) return Buffer.from(await dlRes.arrayBuffer());
          return v.url;
        }
        if (v?.status === 4 || v?.status === 6 || v?.status === 7 || v?.status === 8) {
          console.error('Pixverse video failed, status:', v.status);
          return null;
        }
      } catch {}
    }
    console.error('Pixverse timeout');
    return null;
  } catch (err) { console.error('Pixverse error:', err.message); return null; }
}

// ===== ROUTES =====

// --- Avatar creation (FREE) ---
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
    const desc = req.body.description
      .replace(/\b(sexy|hot|nude|naked|nsfw|explicit|busty|thicc|seductive|lingerie|bikini|succubus|demon)\b/gi, '')
      .replace(/\s+/g, ' ').trim();

    let prompt;
    if (isAnime) {
      prompt = `beautiful anime character portrait, ${gender}, ${desc}, anime art style, vibrant colors, detailed eyes, soft lighting, casual outfit, high quality illustration`;
    } else {
      prompt = `photorealistic portrait of a ${gender}, ${desc}, professional photography, 85mm lens, natural lighting, genuine smile, casual clothing, high resolution, detailed skin, sharp focus, front facing`;
    }

    console.log('🎨 Avatar:', prompt.substring(0, 80) + '...');

    // Generate with a fixed seed so we can reuse it for consistency
    const avatarSeed = Math.floor(Math.random() * 999999);
    let result = await generateWithPollinations(prompt, 1024, 1024, avatarSeed);
    let provider = result ? 'pollinations' : '';

    if (!result) {
      result = await generateWithOpenAI(prompt);
      if (result) provider = 'openai';
    }

    if (!result) {
      return res.status(500).json({ error: 'Image generation failed. Try uploading manually.' });
    }

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), result.buffer);
    console.log(`✅ Avatar saved: ${filename} (${provider}, seed:${result.seed})`);

    res.json({ avatar_url: `/uploads/${filename}`, provider, seed: result.seed });
  } catch (err) {
    console.error('Avatar error:', err);
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// --- Scene photo with character consistency (costs tokens) ---
router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const isAnime = companion.art_style === 'Anime';
    const { setting, outfit } = getRandomScene();
    const desc = (companion.description || '')
      .replace(/\b(sexy|hot|nude|naked|nsfw|explicit|succubus|demon)\b/gi, '').trim();

    // Build identity-preserving prompt
    let prompt;
    if (isAnime) {
      prompt = `anime ${gender}, ${desc}, ${setting}, wearing ${outfit}, anime art, vibrant, detailed`;
    } else {
      prompt = `Use the provided reference image as identity anchor. This is the SAME person. Preserve exact face, facial structure, skin tone, hairstyle, body proportions. Change ONLY: outfit to ${outfit}, setting to ${setting}. Do not alter identity. Photorealistic, cinematic lighting, detailed skin texture, high resolution`;
    }

    console.log('📸 Scene:', prompt.substring(0, 80) + '...');

    // Use avatar as reference image for character consistency
    let referenceUrl = null;
    if (companion.avatar_url && !isAnime) {
      const baseUrl = getPublicUrl(req);
      referenceUrl = `${baseUrl}${companion.avatar_url}`;
      console.log('📸 Reference image:', referenceUrl);
    }

    let result = await generateWithPollinations(prompt, 1024, 1024, null, referenceUrl);
    let provider = result ? 'pollinations' : '';

    if (!result) {
      // Fallback without reference
      const fallbackPrompt = `photorealistic ${gender}, ${desc}, ${setting}, wearing ${outfit}, professional photo, natural lighting, high res`;
      result = await generateWithPollinations(fallbackPrompt);
      if (result) provider = 'pollinations-fallback';
    }

    if (!result) {
      result = await generateWithOpenAI(`${gender}, ${desc}, ${setting}, wearing ${outfit}`);
      if (result) provider = 'openai';
    }

    if (!result) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.image, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    const filename = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), result.buffer);
    const finalUrl = `/uploads/${filename}`;

    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', finalUrl]
    );

    console.log(`✅ Scene: ${filename} (${provider})`);
    res.json({ image_url: finalUrl, caption: '📸', provider });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene error:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// --- Video generation (costs tokens) ---
router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const isAnime = companion.art_style === 'Anime';
    const { setting, outfit } = getRandomScene();
    const desc = (companion.description || '')
      .replace(/\b(sexy|hot|nude|naked|nsfw|explicit|succubus|demon)\b/gi, '').trim();

    // Generate scene image first (with reference for consistency)
    let prompt;
    if (isAnime) {
      prompt = `anime ${gender}, ${desc}, ${setting}, wearing ${outfit}, anime, detailed`;
    } else {
      prompt = `Use the provided reference image. Same person. Preserve face, identity. Setting: ${setting}, wearing ${outfit}. Photorealistic, cinematic`;
    }

    let referenceUrl = null;
    if (companion.avatar_url && !isAnime) {
      referenceUrl = `${getPublicUrl(req)}${companion.avatar_url}`;
    }

    let result = await generateWithPollinations(prompt, 1024, 1024, null, referenceUrl);
    if (!result) result = await generateWithOpenAI(`${gender}, ${desc}, ${setting}, wearing ${outfit}`);

    if (!result) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.video, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    const sceneFilename = `vscene-${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadDir, sceneFilename), result.buffer);

    // Convert to video
    const motionPrompt = `${gender} gently smiling, subtle natural movement, cinematic`;
    let videoBuffer = await generateVideoWithPixverse(sceneFilename, motionPrompt);

    if (videoBuffer) {
      let videoUrl;
      if (Buffer.isBuffer(videoBuffer)) {
        const vf = `video-${Date.now()}.mp4`;
        fs.writeFileSync(path.join(uploadDir, vf), videoBuffer);
        videoUrl = `/uploads/${vf}`;
      } else {
        videoUrl = videoBuffer;
      }

      await pool.query(
        `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
        [req.user.id, companionId, '🎬', videoUrl]
      );
      try { fs.unlinkSync(path.join(uploadDir, sceneFilename)); } catch {}
      console.log('✅ Video generated');
      return res.json({ video_url: videoUrl, caption: '🎬' });
    }

    // Fallback: return image, partial refund
    const refund = TOKEN_COSTS.video - TOKEN_COSTS.image;
    if (refund > 0) await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [refund, req.user.id]);

    const imageUrl = `/uploads/${sceneFilename}`;
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', imageUrl]
    );
    res.json({ image_url: imageUrl, video_url: null, caption: '📸', note: 'Video unavailable. Showing image. Partial refund.' });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video error:', err);
    res.status(500).json({ error: 'Video generation failed' });
  }
});

module.exports = router;
