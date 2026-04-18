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

function getPublicUrl(req, localPath) {
  if (localPath.startsWith('http')) return localPath;
  const base = process.env.CLIENT_URL || `https://${req.headers.host}`;
  return `${base}${localPath}`;
}

function getRandomScene() {
  const settings = [
    'at a cozy coffee shop with warm ambient lighting, sitting by the window with a latte',
    'at the beach during golden hour, ocean waves in background, wind in hair',
    'in a modern apartment living room, relaxing on a white sofa, soft daylight',
    'at a rooftop restaurant at night, city skyline lights behind',
    'in a beautiful garden with blooming flowers, soft natural sunlight',
    'at a park bench in autumn, golden fallen leaves around, warm afternoon light',
    'in a bedroom with morning sunlight streaming through sheer curtains',
    'walking down a European cobblestone street at sunset',
    'at a pool party, sitting by the pool edge, turquoise water',
    'in a cozy kitchen, cooking, natural light from window',
    'at a gym, sporty pose, athletic outfit, bright lighting',
    'at a balcony overlooking the ocean, sunset colors in sky',
    'in a luxury car interior, leather seats, cinematic lighting',
    'at a music festival at night, colorful stage lights in background',
  ];
  const outfits = [
    'wearing a casual elegant dress', 'in a fitted top and high-waisted jeans',
    'wearing a cozy oversized sweater', 'in a summer sundress',
    'wearing a trendy crop top and skirt', 'in elegant evening wear',
    'wearing a silk blouse and trousers', 'in athletic wear',
    'wearing a stylish leather jacket', 'in a cute off-shoulder top',
  ];
  return {
    setting: settings[Math.floor(Math.random() * settings.length)],
    outfit: outfits[Math.floor(Math.random() * outfits.length)],
  };
}

// ===== Google Nano Banana (Gemini 2.5 Flash Image) =====
// FREE on Google AI Studio, keeps character consistency when you pass the avatar image

async function generateWithGemini(prompt, referenceImagePath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.log('⚠️ No GEMINI_API_KEY'); return null; }

  // Retry up to 3 times with backoff for rate limits
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const delay = attempt * 5000; // 5s, 10s
        console.log(`🍌 Gemini retry ${attempt + 1}/3, waiting ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.log('🍌 Trying Google Nano Banana...');
      }

      const parts = [{ text: prompt }];

      // If we have a reference image (the avatar), include it for character consistency
      if (referenceImagePath) {
        let imageBase64;
        const localPath = referenceImagePath.startsWith('/uploads/') || referenceImagePath.startsWith('uploads/')
          ? path.join(uploadDir, path.basename(referenceImagePath))
          : referenceImagePath.startsWith('/') ? path.join(__dirname, '..', referenceImagePath) : null;

        if (localPath && fs.existsSync(localPath)) {
          imageBase64 = fs.readFileSync(localPath).toString('base64');
        }
        if (imageBase64) {
          parts.unshift({
            inlineData: { mimeType: 'image/png', data: imageBase64 }
          });
        }
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ['IMAGE'],
            },
          }),
        }
      );

      if (res.status === 429) {
        console.log('🍌 Gemini rate limited (429), will retry...');
        continue; // retry
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error('Gemini error:', res.status, errText.substring(0, 300));
        return null;
      }

      const data = await res.json();
      const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (imagePart?.inlineData?.data) {
        console.log('✅ Nano Banana image generated');
        return Buffer.from(imagePart.inlineData.data, 'base64');
      }

      console.error('Gemini: no image in response');
      return null;
    } catch (err) {
      console.error('Gemini error:', err.message);
      if (attempt < 2) continue;
      return null;
    }
  }
  return null;
}

// ===== DALL-E fallback =====

async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.log('⚠️ No OPENAI_API_KEY'); return null; }
  try {
    console.log('🎨 Trying OpenAI DALL-E fallback...');
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3', prompt: prompt + '. Tasteful, appropriate, fully clothed, professional photo.',
        n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('DALL-E error:', res.status, errText.substring(0, 200));
      return null;
    }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    console.log('✅ DALL-E image generated');
    return Buffer.from(b64, 'base64');
  } catch (err) { console.error('DALL-E error:', err.message); return null; }
}

// ===== Pixverse Image-to-Video (free daily credits) =====

async function generateVideoWithPixverse(imageUrl, prompt) {
  const apiKey = process.env.PIXVERSE_API_KEY;
  if (!apiKey) { console.log('⚠️ No PIXVERSE_API_KEY'); return null; }

  try {
    console.log('🎬 Trying Pixverse image-to-video...');

    // Step 1: Upload image to Pixverse
    const imgBuffer = fs.readFileSync(imageUrl.startsWith('/') ?
      path.join(__dirname, '..', imageUrl) :
      path.join(uploadDir, path.basename(imageUrl))
    );

    // Use form-data to upload image
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('image', imgBuffer, { filename: 'scene.png', contentType: 'image/png' });

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
    const imgId = uploadData.Resp?.img_id || uploadData.Resp?.id;
    if (!imgId) {
      console.error('Pixverse: no img_id in upload response', JSON.stringify(uploadData).substring(0, 200));
      return null;
    }

    console.log(`🎬 Pixverse image uploaded, id: ${imgId}`);

    // Step 2: Generate video
    const genRes = await fetch('https://app-api.pixverse.ai/openapi/v2/video/img/generate', {
      method: 'POST',
      headers: {
        'API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        duration: 5,
        img_id: imgId,
        model: 'v5.6',
        motion_mode: 'normal',
        prompt: prompt || 'gentle smile, subtle natural movement, soft breeze',
        negative_prompt: 'fast movement, distortion, blur',
        quality: '540p',
      }),
    });

    if (!genRes.ok) {
      const errText = await genRes.text();
      console.error('Pixverse generate error:', genRes.status, errText.substring(0, 200));
      return null;
    }

    const genData = await genRes.json();
    const videoId = genData.Resp?.id;
    if (!videoId) {
      console.error('Pixverse: no video id', JSON.stringify(genData).substring(0, 200));
      return null;
    }

    console.log(`🎬 Pixverse video generation started, id: ${videoId}`);

    // Step 3: Poll for result (max 120 seconds)
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const pollRes = await fetch(`https://app-api.pixverse.ai/openapi/v2/video/${videoId}`, {
        headers: { 'API-KEY': apiKey },
      });

      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const video = pollData.Resp;

      if (video?.status === 1 && video?.url) {
        console.log('✅ Pixverse video completed:', video.url.substring(0, 80));
        // Download video
        const videoRes = await fetch(video.url);
        if (videoRes.ok) {
          return Buffer.from(await videoRes.arrayBuffer());
        }
        return video.url; // Return URL if download fails
      }

      if (video?.status === 4 || video?.status === 6) {
        console.error('Pixverse video failed, status:', video.status);
        return null;
      }

      console.log(`🎬 Pixverse polling... status: ${video?.status} (${i + 1}/40)`);
    }

    console.error('Pixverse video timed out');
    return null;
  } catch (err) {
    console.error('Pixverse error:', err.message);
    return null;
  }
}

// ===== Runway ML fallback for video =====

async function generateVideoWithRunway(imageBuffer, prompt) {
  const runwayKey = process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY;
  if (!runwayKey) return null;

  try {
    console.log('🎬 Trying Runway Gen-4 Turbo fallback...');
    const dataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    const createRes = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${runwayKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify({
        model: 'gen4_turbo',
        promptImage: dataUri,
        promptText: prompt || 'gentle smile, subtle natural movement, cinematic',
        ratio: '720:1280',
        duration: 5,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('Runway error:', createRes.status, errText.substring(0, 200));
      return null;
    }

    const taskData = await createRes.json();
    const taskId = taskData.id;

    // Poll
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${runwayKey}`, 'X-Runway-Version': '2024-11-06' },
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      if (pollData.status === 'SUCCEEDED') {
        const url = pollData.output?.[0] || pollData.artifactUrl;
        if (url) {
          const videoRes = await fetch(url);
          if (videoRes.ok) return Buffer.from(await videoRes.arrayBuffer());
        }
        return null;
      }
      if (pollData.status === 'FAILED') return null;
    }
    return null;
  } catch (err) { console.error('Runway error:', err.message); return null; }
}

// ===== ROUTES =====

// Generate avatar during character creation (FREE)
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
    // Clean description more aggressively for safety
    const desc = req.body.description
      .replace(/\b(sexy|hot|nude|naked|nsfw|explicit|busty|thicc|seductive|lingerie|bikini|underwear|bra|panties|cleavage|succubus|demon girl)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    let prompt;
    if (isAnime) {
      prompt = `Create a beautiful anime character portrait of a ${gender}. ${desc}. High quality anime illustration, vibrant colors, detailed eyes, clean lines, elegant casual outfit, soft lighting`;
    } else {
      prompt = `Create a photorealistic portrait of a friendly ${gender}, ${desc}. Professional photography, 85mm lens, natural lighting, genuine warm smile, casual clothing, high resolution`;
    }

    // Try Gemini first (free + best quality), then DALL-E fallback
    let imageBuffer = await generateWithGemini(prompt, null);
    let provider = imageBuffer ? 'gemini-nano-banana' : '';

    if (!imageBuffer) {
      imageBuffer = await generateWithOpenAI(prompt);
      if (imageBuffer) provider = 'openai';
    }

    if (!imageBuffer) {
      return res.status(500).json({ error: 'Image generation unavailable. Upload manually.' });
    }

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);
    console.log(`✅ Avatar saved: ${filename} (${provider}, ${Math.round(imageBuffer.length / 1024)}KB)`);

    res.json({ avatar_url: `/uploads/${filename}`, provider });
  } catch (err) {
    console.error('Avatar gen error:', err);
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// Generate scene photo with character consistency (costs tokens)
router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const { setting, outfit } = getRandomScene();

    // Gemini Nano Banana: pass avatar as reference image + scene prompt
    // This keeps the SAME face/character and changes the environment
    const prompt = `Show this exact same person ${setting}, ${outfit}. Keep the same face, same identity. Ultra realistic photograph, photorealistic, high resolution, candid natural pose, beautiful lighting`;

    let imageBuffer = await generateWithGemini(prompt, companion.avatar_url);
    let provider = imageBuffer ? 'gemini-nano-banana' : '';

    // Fallback to DALL-E (won't have consistent face but still generates a scene)
    if (!imageBuffer) {
      const fallbackPrompt = `Ultra realistic photograph of a beautiful young ${gender}, ${setting}, ${outfit}. Photorealistic, high resolution, candid pose`;
      imageBuffer = await generateWithOpenAI(fallbackPrompt);
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

    console.log(`✅ Scene photo: ${filename} (${provider})`);
    res.json({ image_url: finalUrl, caption: '📸', provider });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene gen error:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// Generate video (costs tokens)
router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    // Step 1: Generate a scene image first (with character consistency via Gemini)
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const { setting, outfit } = getRandomScene();
    const prompt = `Show this exact same person ${setting}, ${outfit}. Keep the same face. Ultra realistic, photorealistic, high resolution`;

    let sceneBuffer = await generateWithGemini(prompt, companion.avatar_url);
    if (!sceneBuffer) {
      const fallbackPrompt = `Ultra realistic photograph of a beautiful young ${gender}, ${setting}, ${outfit}. Photorealistic`;
      sceneBuffer = await generateWithOpenAI(fallbackPrompt);
    }

    if (!sceneBuffer) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.video, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    const sceneFilename = `vscene-${Date.now()}.png`;
    const scenePath = path.join(uploadDir, sceneFilename);
    fs.writeFileSync(scenePath, sceneBuffer);

    // Step 2: Convert image to video
    const motionPrompt = `${gender} gently smiling, subtle natural movement, soft breeze, cinematic`;

    // Try Pixverse first (free), then Runway (paid)
    let videoBuffer = await generateVideoWithPixverse(`/uploads/${sceneFilename}`, motionPrompt);

    if (!videoBuffer && (process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY)) {
      videoBuffer = await generateVideoWithRunway(sceneBuffer, motionPrompt);
    }

    if (videoBuffer) {
      let videoUrl;
      if (Buffer.isBuffer(videoBuffer)) {
        const videoFilename = `video-${Date.now()}.mp4`;
        fs.writeFileSync(path.join(uploadDir, videoFilename), videoBuffer);
        videoUrl = `/uploads/${videoFilename}`;
      } else {
        videoUrl = videoBuffer; // URL string from API
      }

      await pool.query(
        `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
        [req.user.id, companionId, '🎬', videoUrl]
      );

      try { fs.unlinkSync(scenePath); } catch {}
      console.log('✅ Video generated');
      return res.json({ video_url: videoUrl, caption: '🎬' });
    }

    // Fallback: return the scene image, partial refund
    const refund = TOKEN_COSTS.video - TOKEN_COSTS.image;
    if (refund > 0) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [refund, req.user.id]);
    }

    const imageUrl = `/uploads/${sceneFilename}`;
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', imageUrl]
    );

    console.log('⚠️ Video APIs unavailable, showing image instead');
    res.json({ image_url: imageUrl, video_url: null, caption: '📸', note: 'Video API not available. Showing image. Partial refund applied.' });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video gen error:', err);
    res.status(500).json({ error: 'Video generation failed' });
  }
});

module.exports = router;
