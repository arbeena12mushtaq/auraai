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
  { setting: 'cozy coffee shop, warm lighting, sitting by window', outfit: 'elegant knit sweater and tailored trousers, chic styling' },
  { setting: 'beach during golden hour, ocean behind', outfit: 'flowy maxi dress, bohemian resort styling' },
  { setting: 'modern apartment, soft daylight, on sofa', outfit: 'casual chic blouse and jeans, relaxed editorial look' },
  { setting: 'rooftop restaurant, city lights, night', outfit: 'sleek black evening dress with jacket, sophisticated styling' },
  { setting: 'garden with flowers, soft sunlight', outfit: 'floral midi dress, romantic elegant styling' },
  { setting: 'park in autumn, golden leaves', outfit: 'leather jacket over turtleneck and stylish skirt, editorial fashion look' },
  { setting: 'library with wooden shelves, warm light', outfit: 'tailored blazer and smart trousers, intellectual chic styling' },
  { setting: 'cobblestone street at sunset, European city', outfit: 'fitted trench coat over designer dress, fashionable editorial styling' },
  { setting: 'art gallery, white walls, modern sculptures', outfit: 'minimalist black outfit, gallery-chic fashion' },
  { setting: 'balcony overlooking ocean, sunset sky', outfit: 'elegant wrap dress and statement jewelry, luxury fashion styling' },
  { setting: 'luxury car interior, leather seats', outfit: 'bold high-fashion outfit, blazer with glamorous styling' },
  { setting: 'mountain viewpoint, misty landscape behind', outfit: 'stylish outdoor coat and boots, adventure-chic look' },
  { setting: 'rainy city street, neon reflections, night', outfit: 'sleek dark coat and heels, noir fashion styling' },
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

  const chosenScene = scenes[Math.floor(Math.random() * scenes.length)];
  const chosenCamera = cameras[Math.floor(Math.random() * cameras.length)];

  return {
    setting: chosenScene.setting,
    outfit: chosenScene.outfit,
    camera: chosenCamera,
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
  if (!apiKey) {
    console.log('⚠️ No OPENAI_API_KEY');
    return null;
  }

  try {
    console.log('🎨 GPT Image edit...');
    console.log('🎨 Edit:', editPrompt.substring(0, 100) + '...');

    let fileBuffer;
    let mimeType = 'image/png';
    let filename = 'avatar.png';

    // Handle external URLs (https://...)
    if (avatarImagePath.startsWith('http://') || avatarImagePath.startsWith('https://')) {
      console.log('🎨 Downloading external avatar...');
      const dlRes = await fetch(avatarImagePath);
      if (!dlRes.ok) {
        console.error('Failed to download avatar:', dlRes.status);
        return null;
      }
      fileBuffer = Buffer.from(await dlRes.arrayBuffer());
      const ct = dlRes.headers.get('content-type') || '';
      if (ct.includes('jpeg') || ct.includes('jpg')) mimeType = 'image/jpeg';
      filename = 'avatar.' + (mimeType === 'image/jpeg' ? 'jpg' : 'png');
    } else {
      // Local path — resolve from uploads directory
      const fullPath = path.join(uploadDir, path.basename(avatarImagePath));
      if (!fs.existsSync(fullPath)) {
        console.error('Avatar not found:', fullPath);
        return null;
      }
      fileBuffer = fs.readFileSync(fullPath);
      if (fullPath.endsWith('.jpg') || fullPath.endsWith('.jpeg')) mimeType = 'image/jpeg';
      filename = path.basename(fullPath);
    }

    const strongPrompt = `Edit this portrait photo. This is a professional fashion photography edit — fully clothed, tasteful, non-sexual.

Keep the EXACT same person — same face, same eyes, same skin, same hair, same wings if present. Do not change their identity at all. Only change what is specified below.

${editPrompt}

Style: Professional editorial photography, natural lighting, fully clothed, tasteful.`;
    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    fd.append('image[]', new Blob([fileBuffer], { type: mimeType }), filename);
    fd.append('prompt', strongPrompt);
    fd.append('quality', 'high');
    fd.append('size', '1024x1024');

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

async function generateVideoWithKling(imageFilePath, prompt) {
  const jwt = require('jsonwebtoken');
  
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  
  if (!accessKey || !secretKey) {
    console.log('⚠️ Missing KLING_ACCESS_KEY or KLING_SECRET_KEY');
    return null;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      iss: accessKey,
      iat: now,
      nbf: now - 5,
      exp: now + 3600
    },
    secretKey,
    { algorithm: 'HS256' }
  );

  
  const apiBase = process.env.KLING_API_BASE || 'https://api-singapore.klingai.com';
  const createPath = process.env.KLING_IMAGE_TO_VIDEO_PATH;
  const taskPath = process.env.KLING_TASK_GET_PATH;
  console.log('KLING JWT TOKEN:', token);
  
  if (!createPath || !taskPath) {
    console.log('⚠️ Missing KLING_IMAGE_TO_VIDEO_PATH or KLING_TASK_GET_PATH');
    return null;
  }

  try {
    console.log('🎬 Kling: preparing image-to-video request...');

    const fullPath = path.isAbsolute(imageFilePath)
      ? imageFilePath
      : path.join(uploadDir, path.basename(imageFilePath));

    if (!fs.existsSync(fullPath)) {
      console.error('Kling source image not found:', fullPath);
      return null;
    }

    const fileBuffer = fs.readFileSync(fullPath);
    const mimeType =
      fullPath.endsWith('.jpg') || fullPath.endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/png';

    // Kling docs confirm image-to-video support, but the exact field name/path
    // must match your official dashboard docs. Most providers accept a data URI.
    const base64 = fileBuffer.toString('base64');
    
    const body = {
      model_name: "kling-v2-6",
      image: base64, // ✅ IMPORTANT: NO "data:image/png;base64,"
      prompt: prompt || "slight head movement, natural blinking, soft smile",
      duration: "5",
      mode: "std",
      sound: "off"
    };

    
    const createRes = await fetch(`${apiBase}${createPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const createText = await createRes.text();
    console.log('Kling create status:', createRes.status);
    console.log('Kling create raw:', createText.substring(0, 500));

    if (!createRes.ok) {
      return null;
    }

    let createData;
    try {
      createData = JSON.parse(createText);
    } catch {
      console.error('Kling create: invalid JSON');
      return null;
    }

    // Common task id shapes; adjust if your official docs use another key
    const taskId =
      createData?.data?.task_id ||
      createData?.task_id ||
      createData?.data?.id ||
      createData?.id;

    if (!taskId) {
      console.error('Kling: no task_id in response');
      return null;
    }

    console.log(`🎬 Kling task created: ${taskId}`);

    // Poll result
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const pollRes = await fetch(`${apiBase}${taskPath.replace('{task_id}', taskId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      const pollText = await pollRes.text();
      if (!pollRes.ok) {
        console.log('Kling poll status:', pollRes.status);
        continue;
      }

      let pollData;
      try {
        pollData = JSON.parse(pollText);
      } catch {
        continue;
      }

      if (i % 4 === 0) {
        console.log('Kling poll raw:', pollText.substring(0, 300));
      }

      const status = pollData?.data?.task_status;
      const videoUrl = pollData?.data?.task_result?.videos?.[0]?.url;
      
      if (videoUrl) {
        console.log('✅ Kling video done');
        const dl = await fetch(videoUrl);
        return dl.ok ? Buffer.from(await dl.arrayBuffer()) : videoUrl;
      }

      if (['failed', 'FAIL', 'error', 'ERROR'].includes(String(status))) {
        console.error('Kling failed:', status);
        return null;
      }

      console.log(`🎬 Kling status: ${status || 'processing'} (${i}/40)`);
    }

    return null;
  } catch (err) {
    console.error('Kling:', err.message);
    return null;
  }
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

    const editPrompt = `Place this exact person in: ${setting}. Dress them in: ${outfit}. Camera: ${camera}. Keep the same face, same hair, same body, same wings. Photorealistic.`;
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
    const videoBuffer = await generateVideoWithKling(
      path.join(uploadDir, sceneFile),
      `${gender} slight head movement, natural blinking, soft smile, subtle body movement, realistic motion`
    );
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
