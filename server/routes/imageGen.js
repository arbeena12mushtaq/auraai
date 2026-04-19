const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { authMiddleware, contentFilter } = require('../middleware/auth');

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
    .replace(/\b(nude|naked|nsfw|explicit|topless|bottomless|genitals|penis|vagina|porn|xxx)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
}

function getRandomScene() {
  const scenes = [
    { setting: 'cozy coffee shop, warm lighting, sitting by window', outfit: 'casual elegant dress' },
    { setting: 'beach during golden hour, ocean behind', outfit: 'summer sundress' },
    { setting: 'modern apartment, soft daylight, on sofa', outfit: 'cozy sweater and jeans' },
    { setting: 'rooftop restaurant, city lights, night', outfit: 'elegant evening wear' },
    { setting: 'garden with flowers, soft sunlight', outfit: 'floral blouse and skirt' },
    { setting: 'park in autumn, golden leaves', outfit: 'leather jacket and boots' },
    { setting: 'bedroom, morning sunlight through curtains', outfit: 'silk pajamas' },
    { setting: 'cobblestone street at sunset, European city', outfit: 'fitted top and skirt' },
    { setting: 'swimming pool area, sunny day', outfit: 'casual athletic wear' },
    { setting: 'kitchen cooking, natural window light', outfit: 'apron over casual clothes' },
    { setting: 'balcony overlooking ocean, sunset sky', outfit: 'off-shoulder top and jeans' },
    { setting: 'luxury car interior, leather seats', outfit: 'blazer and silk blouse' },
  ];
  const cameras = [
    'selfie angle, phone held at arm length, slightly above eye level, front facing',
    'close-up portrait, face filling frame, shallow depth of field, looking at camera',
    'medium shot from waist up, 3/4 angle view, natural pose',
    'full body shot, straight on, standing pose, eye level camera',
    'over the shoulder selfie, looking back at camera with a smile',
    'low angle shot looking up, dramatic perspective, confident pose',
    'candid side profile, natural moment, soft focus background',
    'mirror selfie, phone visible in hand, casual pose',
    'sitting pose, shot from slightly above, relaxed and natural',
    'walking towards camera, mid-stride, street style photography',
    'leaning against wall, 3/4 body, casual cool pose',
    'close-up selfie, big smile, slightly tilted head, warm expression',
  ];
  return {
    setting: scenes[Math.floor(Math.random() * scenes.length)].setting,
    outfit: scenes[Math.floor(Math.random() * scenes.length)].outfit,
    camera: cameras[Math.floor(Math.random() * cameras.length)],
  };
}

// ===== Pollinations.ai — FREE, for avatar creation =====

async function generateWithPollinations(prompt, width = 1024, height = 1024) {
  try {
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&model=flux`;
    console.log(`🌸 Pollinations (seed:${seed})...`);

    const res = await fetch(url);
    if (!res.ok) { console.error('Pollinations:', res.status); return null; }
    if (!(res.headers.get('content-type') || '').includes('image')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 3000) return null;

    console.log(`✅ Pollinations (${Math.round(buffer.length / 1024)}KB)`);
    return buffer;
  } catch (err) { console.error('Pollinations:', err.message); return null; }
}

// ===== OpenAI GPT Image Edit — Character-consistent image editing =====
// Uses gpt-image-1 to edit avatar into new scenes while keeping same face
// Uses the SAME OpenAI API key the client already has — no new account needed

async function editWithGPTImage(avatarImagePath, editPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.log('⚠️ No OPENAI_API_KEY'); return null; }

  try {
    console.log('🎨 GPT Image edit...');
    console.log('🎨 Edit:', editPrompt.substring(0, 100) + '...');

    const fullPath = path.join(uploadDir, path.basename(avatarImagePath));
    if (!fs.existsSync(fullPath)) { console.error('Avatar not found:', fullPath); return null; }

    // gpt-image-1 edits MUST use multipart/form-data (not JSON)
    // Format: -F "model=gpt-image-1" -F "image[]=@file.png" -F "prompt=..." 
    const FormData = require('form-data');
    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    fd.append('image[]', fs.createReadStream(fullPath), {
      filename: path.basename(fullPath),
      contentType: fullPath.endsWith('.jpg') || fullPath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
    });
    fd.append('prompt', editPrompt);
    fd.append('quality', 'low');
    fd.append('size', '1024x1024');

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...fd.getHeaders(),
      },
      body: fd,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('GPT Image error:', res.status, errText.substring(0, 300));
      return null;
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (b64) {
      console.log('✅ GPT Image edit done');
      return Buffer.from(b64, 'base64');
    }

    console.error('GPT Image: no b64 in response');
    return null;
  } catch (err) {
    console.error('GPT Image error:', err.message);
    return null;
  }
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
        model: 'dall-e-3', prompt: prompt + '. Tasteful, professional.',
        n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json',
      }),
    });
    if (!res.ok) { console.error('DALL-E:', res.status); return null; }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (err) { console.error('DALL-E:', err.message); return null; }
}

// ===== Pixverse Video =====

async function generateVideoWithPixverse(imageFilePath, prompt) {
  const apiKey = process.env.PIXVERSE_API_KEY;
  if (!apiKey) { console.log('⚠️ No PIXVERSE_API_KEY'); return null; }

  try {
    console.log('🎬 Pixverse: uploading...');
    const fullPath = path.join(uploadDir, path.basename(imageFilePath));
    if (!fs.existsSync(fullPath)) return null;

    const { v4: uuidv4 } = require('uuid');
    const FD = require('form-data');

    // Step 1: Upload image with Ai-trace-id
    const fd = new FD();
    fd.append('image', fs.createReadStream(fullPath), {
      filename: path.basename(fullPath),
      contentType: 'image/png',
    });

    const uploadRes = await fetch('https://app-api.pixverse.ai/openapi/v2/image/upload', {
      method: 'POST',
      headers: {
        'API-KEY': apiKey,
        'Ai-trace-id': uuidv4(),
        ...fd.getHeaders(),
      },
      body: fd,
    });

    if (!uploadRes.ok) {
      console.error('Pixverse upload:', uploadRes.status, (await uploadRes.text()).substring(0, 200));
      return null;
    }

    const uploadData = await uploadRes.json();
    console.log('Pixverse upload:', JSON.stringify(uploadData).substring(0, 200));
    const imgId = uploadData?.Resp?.img_id;
    if (!imgId) { console.error('Pixverse: no img_id'); return null; }

    // Step 2: Generate video
    const genRes = await fetch('https://app-api.pixverse.ai/openapi/v2/video/img/generate', {
      method: 'POST',
      headers: {
        'API-KEY': apiKey,
        'Ai-trace-id': uuidv4(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        duration: 5,
        img_id: imgId,
        model: 'v4.5',
        motion_mode: 'normal',
        quality: '540p',
        prompt: prompt || 'gentle smile, subtle movement',
        negative_prompt: 'fast motion, distortion',
      }),
    });

    if (!genRes.ok) {
      console.error('Pixverse gen:', genRes.status, (await genRes.text()).substring(0, 200));
      return null;
    }

    const genData = await genRes.json();
    const videoId = genData.Resp?.video_id || genData.Resp?.id;
    if (!videoId) { console.error('Pixverse: no video_id'); return null; }

    console.log(`🎬 Pixverse video: ${videoId}`);

    // Step 3: Poll using /video/result/{id} endpoint
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const p = await fetch(`https://app-api.pixverse.ai/openapi/v2/video/result/${videoId}`, {
          headers: { 'API-KEY': apiKey, 'Ai-trace-id': uuidv4() },
        });
        if (!p.ok) continue;
        const d = await p.json();
        if (d.Resp?.status === 1 && d.Resp?.url) {
          console.log('✅ Pixverse video done');
          const dl = await fetch(d.Resp.url);
          return dl.ok ? Buffer.from(await dl.arrayBuffer()) : d.Resp.url;
        }
        if ([7, 8].includes(d.Resp?.status)) {
          console.error('Pixverse failed:', d.Resp?.status);
          return null;
        }
        if (i % 5 === 0) console.log(`🎬 Pixverse status: ${d.Resp?.status} (${i}/40)`);
      } catch {}
    }
    return null;
  } catch (err) { console.error('Pixverse:', err.message); return null; }
}

// ===== ROUTES =====

// --- Avatar creation (FREE via Pollinations) ---
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
      prompt = `anime character portrait, ${gender}, ${desc}, anime art, vibrant colors, detailed eyes, front facing, looking at camera`;
    } else {
      prompt = `photorealistic portrait of a ${gender}, ${desc}, professional photography, 85mm lens, natural lighting, detailed skin, front facing, looking at camera, high resolution`;
    }

    console.log('🎨 Avatar prompt:', prompt);

    let imageBuffer = await generateWithPollinations(prompt);
    let provider = imageBuffer ? 'pollinations' : '';

    if (!imageBuffer) {
      imageBuffer = await generateWithOpenAI(prompt);
      if (imageBuffer) provider = 'openai';
    }

    if (!imageBuffer) return res.status(500).json({ error: 'Image generation failed. Try uploading.' });

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);
    console.log(`✅ Avatar: ${filename} (${provider})`);

    res.json({ avatar_url: `/uploads/${filename}`, provider });
  } catch (err) {
    console.error('Avatar error:', err);
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// --- Scene photo: FLUX Kontext edits the avatar into a new scene ---
router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    const { setting, outfit, camera } = getRandomScene();

    // Build the edit prompt with camera angle
    const editPrompt = `Change the setting to: ${setting}. Change the outfit to: ${outfit}. Camera angle: ${camera}. Keep the exact same person, same face, same identity, same skin tone, same hairstyle. Photorealistic, natural lighting, high resolution.`;

    console.log('📸 Scene:', setting.substring(0, 40), '| Camera:', camera.substring(0, 40));

    // Get the avatar's public URL for fal.ai to fetch

    let imageBuffer = null;
    let provider = '';

    // Try GPT Image edit first (character consistent — uses existing OpenAI key)
    if (companion.avatar_url) {
      imageBuffer = await editWithGPTImage(companion.avatar_url, editPrompt);
      if (imageBuffer) provider = 'gpt-image-edit';
    }

    // Fallback to Pollinations (no consistency)
    if (!imageBuffer) {
      const gender = companion.category === 'Guys' ? 'man' : 'woman';
      const desc = sanitizePrompt(companion.description || '');
      const fallbackPrompt = `photorealistic ${gender}, ${desc}, ${setting}, wearing ${outfit}, ${camera}, professional photo, natural lighting`;
      imageBuffer = await generateWithPollinations(fallbackPrompt);
      if (imageBuffer) provider = 'pollinations-fallback';
    }

    // Fallback to DALL-E
    if (!imageBuffer) {
      const gender = companion.category === 'Guys' ? 'man' : 'woman';
      const desc = sanitizePrompt(companion.description || '');
      imageBuffer = await generateWithOpenAI(`${gender}, ${desc}, ${setting}, wearing ${outfit}`);
      if (imageBuffer) provider = 'openai-fallback';
    }

    if (!imageBuffer) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.image, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    const filename = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);
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

// --- Video: generate scene image then animate ---
router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    const { setting, outfit, camera } = getRandomScene();

    // Step 1: Generate scene image with camera angle
    let sceneBuffer = null;
    const editPrompt = `Change setting to: ${setting}. Change outfit to: ${outfit}. Camera angle: ${camera}. Keep same person, same face. Photorealistic, natural lighting.`;

    if (companion.avatar_url) {
      sceneBuffer = await editWithGPTImage(companion.avatar_url, editPrompt);
    }

    if (!sceneBuffer) {
      const gender = companion.category === 'Guys' ? 'man' : 'woman';
      const desc = sanitizePrompt(companion.description || '');
      sceneBuffer = await generateWithPollinations(`photorealistic ${gender}, ${desc}, ${setting}, wearing ${outfit}`);
    }

    if (!sceneBuffer) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.video, req.user.id]);
      return res.status(500).json({ error: 'Image failed. Tokens refunded.' });
    }

    const sceneFile = `vscene-${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadDir, sceneFile), sceneBuffer);

    // Step 2: Animate with Pixverse
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const videoBuffer = await generateVideoWithPixverse(sceneFile, `${gender} gently smiling, subtle movement, cinematic`);

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
      try { fs.unlinkSync(path.join(uploadDir, sceneFile)); } catch {}
      return res.json({ video_url: videoUrl, caption: '🎬' });
    }

    // Video failed — return image with partial refund
    const refund = TOKEN_COSTS.video - TOKEN_COSTS.image;
    if (refund > 0) await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [refund, req.user.id]);

    const imgUrl = `/uploads/${sceneFile}`;
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', imgUrl]
    );
    res.json({ image_url: imgUrl, video_url: null, caption: '📸', note: 'Video unavailable. Partial refund.' });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video error:', err);
    res.status(500).json({ error: 'Video generation failed' });
  }
});

module.exports = router;
