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

// Get the full public URL for a local file (needed for Replicate API)
function getPublicUrl(req, localPath) {
  if (localPath.startsWith('http')) return localPath;
  const base = process.env.CLIENT_URL || `https://${req.headers.host}`;
  return `${base}${localPath}`;
}

// Random scene settings for variety
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
    'in a high-end shopping district, carrying shopping bags, looking happy',
    'at a pool party, sitting by the pool edge, turquoise water',
    'in a cozy kitchen, cooking, natural light from window',
    'at a gym, sporty pose, athletic outfit, bright lighting',
    'at a music festival at night, colorful stage lights in background',
    'in a luxury car interior, leather seats, cinematic lighting',
    'at a balcony overlooking the ocean, sunset colors in sky',
  ];
  const outfits = [
    'wearing a casual elegant dress', 'in a fitted top and high-waisted jeans',
    'wearing a cozy oversized sweater', 'in a summer sundress',
    'wearing a trendy crop top and skirt', 'in elegant evening wear',
    'wearing a silk blouse and trousers', 'in athletic wear',
    'wearing a stylish leather jacket', 'in a cute off-shoulder top',
    'wearing a designer outfit', 'in a bikini top and sarong',
  ];
  return {
    setting: settings[Math.floor(Math.random() * settings.length)],
    outfit: outfits[Math.floor(Math.random() * outfits.length)],
  };
}

// ===== Image Generation Providers =====

// DALL-E 3
async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3', prompt, n: 1, size: '1024x1024',
        quality: 'standard', response_format: 'b64_json',
      }),
    });
    if (!res.ok) { console.error('DALL-E error:', res.status); return null; }
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (err) { console.error('DALL-E error:', err.message); return null; }
}

// Together AI (Flux - more realistic)
async function generateWithTogetherAI(prompt) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell-Free',
        prompt, negative_prompt: 'nsfw, nude, naked, ugly, deformed, cartoon, anime, painting, drawing',
        width: 768, height: 1024, steps: 4, n: 1, response_format: 'b64_json',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch { return null; }
}

// ===== Face Swap via Replicate =====

async function faceSwap(targetImageUrl, swapImageUrl) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    console.log('⚠️ No REPLICATE_API_TOKEN — skipping face swap');
    return null;
  }

  try {
    console.log('🔄 Starting Replicate face-swap...');

    // Create prediction
    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'd5900f9ebed33e7ae08a07f17e0d98b4ebc68ab9528a70462afc3899cfe23bab',
        input: {
          target_image: targetImageUrl,
          swap_image: swapImageUrl,
          weight: 0.5,
          det_thresh: 0.1,
          cache_days: 10,
        },
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('Replicate create error:', createRes.status, errText.substring(0, 200));
      return null;
    }

    const prediction = await createRes.json();
    const predictionId = prediction.id;
    console.log(`🔄 Face-swap prediction: ${predictionId}`);

    // Poll for result (max 60 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { 'Authorization': `Bearer ${apiToken}` },
      });
      const pollData = await pollRes.json();

      if (pollData.status === 'succeeded') {
        const outputUrl = pollData.output;
        if (outputUrl) {
          console.log('✅ Face-swap completed');
          // Download the result
          const imgRes = await fetch(typeof outputUrl === 'string' ? outputUrl : outputUrl[0] || outputUrl);
          if (imgRes.ok) {
            return Buffer.from(await imgRes.arrayBuffer());
          }
        }
        return null;
      }

      if (pollData.status === 'failed' || pollData.status === 'canceled') {
        console.error('Face-swap failed:', pollData.error);
        return null;
      }
    }

    console.error('Face-swap timed out');
    return null;
  } catch (err) {
    console.error('Face-swap error:', err.message);
    return null;
  }
}

// ===== Routes =====

// Generate avatar during character creation (free)
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
    const desc = req.body.description.replace(/\b(sexy|hot|nude|naked|nsfw|explicit|busty|thicc)\b/gi, '').trim();

    let prompt;
    if (isAnime) {
      prompt = `Anime character portrait of a ${gender}. ${desc}. Clean anime art, vibrant colors, detailed eyes, high quality, casual outfit`;
    } else {
      prompt = `Ultra realistic professional portrait photo of a real ${gender}, ${desc}. Shot on Canon EOS R5, 85mm lens, f/1.8, natural lighting, shallow depth of field, detailed skin texture, photorealistic, high resolution, looking at camera with genuine expression`;
    }

    console.log('🎨 Avatar prompt:', prompt.substring(0, 120) + '...');

    // Prefer Together AI (Flux) for more realistic portraits
    let imageBuffer = await generateWithTogetherAI(prompt);
    let provider = imageBuffer ? 'together-flux' : '';

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

// Generate scene photo with face swap (costs tokens)
router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    // Deduct tokens
    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    // Build scene prompt (generic person + scene, face will be swapped after)
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const { setting, outfit } = getRandomScene();

    const prompt = `Ultra realistic photograph of a beautiful young ${gender}, ${setting}, ${outfit}. Shot on Canon EOS R5, 85mm lens, natural lighting, detailed skin texture, photorealistic, high resolution, candid natural pose, genuine expression`;

    console.log('📸 Scene prompt:', prompt.substring(0, 120) + '...');

    // Generate scene image
    let sceneBuffer = await generateWithTogetherAI(prompt);
    let provider = sceneBuffer ? 'together-flux' : '';

    if (!sceneBuffer) {
      sceneBuffer = await generateWithOpenAI(prompt + '. Safe for work, fully clothed, tasteful.');
      if (sceneBuffer) provider = 'openai';
    }

    if (!sceneBuffer) {
      // Refund
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.image, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    // Save scene image (before face swap)
    const sceneFilename = `scene-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, sceneFilename), sceneBuffer);

    // Face swap: put the avatar's face onto the scene image
    let finalFilename = sceneFilename;

    if (companion.avatar_url && process.env.REPLICATE_API_TOKEN) {
      const sceneUrl = getPublicUrl(req, `/uploads/${sceneFilename}`);
      const avatarUrl = getPublicUrl(req, companion.avatar_url);

      console.log('🔄 Face swap: avatar → scene...');
      const swappedBuffer = await faceSwap(sceneUrl, avatarUrl);

      if (swappedBuffer) {
        finalFilename = `swapped-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
        fs.writeFileSync(path.join(uploadDir, finalFilename), swappedBuffer);
        console.log(`✅ Face-swapped image saved: ${finalFilename}`);
        // Delete the unswapped scene
        try { fs.unlinkSync(path.join(uploadDir, sceneFilename)); } catch {}
      } else {
        console.log('⚠️ Face swap failed, using original scene image');
      }
    } else if (!companion.avatar_url) {
      console.log('⚠️ No avatar URL, skipping face swap');
    } else {
      console.log('⚠️ No REPLICATE_API_TOKEN, skipping face swap');
    }

    const finalUrl = `/uploads/${finalFilename}`;

    // Save as message
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', finalUrl]
    );

    console.log(`✅ Scene photo complete: ${finalFilename} (${provider})`);
    res.json({ image_url: finalUrl, caption: '📸', provider });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Scene gen error:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// Generate video with Runway Gen-4 Turbo (costs tokens)
router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const runwayKey = process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY;
    if (!runwayKey) {
      return res.status(400).json({ error: 'Video generation not configured. RUNWAYML_API_SECRET needed.' });
    }

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    // Step 1: Generate a scene image
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const { setting, outfit } = getRandomScene();
    const prompt = `Ultra realistic photograph of a beautiful young ${gender}, ${setting}, ${outfit}. Photorealistic, high resolution, candid pose`;

    let sceneBuffer = await generateWithTogetherAI(prompt);
    if (!sceneBuffer) sceneBuffer = await generateWithOpenAI(prompt + '. Safe for work, fully clothed.');

    if (!sceneBuffer) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.video, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    const sceneFilename = `vscene-${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadDir, sceneFilename), sceneBuffer);

    // Step 2: Face swap if available
    let finalImgFilename = sceneFilename;
    if (companion.avatar_url && process.env.REPLICATE_API_TOKEN) {
      const sceneUrl = getPublicUrl(req, `/uploads/${sceneFilename}`);
      const avatarUrl = getPublicUrl(req, companion.avatar_url);
      const swappedBuffer = await faceSwap(sceneUrl, avatarUrl);
      if (swappedBuffer) {
        finalImgFilename = `vswapped-${Date.now()}.png`;
        fs.writeFileSync(path.join(uploadDir, finalImgFilename), swappedBuffer);
        try { fs.unlinkSync(path.join(uploadDir, sceneFilename)); } catch {}
      }
    }

    // Step 3: Convert image to video using Runway Gen-4 Turbo
    const imageForVideo = fs.readFileSync(path.join(uploadDir, finalImgFilename));
    const dataUri = `data:image/png;base64,${imageForVideo.toString('base64')}`;

    console.log('🎬 Starting Runway Gen-4 Turbo video generation...');

    // Create task
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
        promptText: `${gender} gently smiling, subtle natural movement, soft breeze, cinematic lighting, photorealistic`,
        ratio: '720:1280',
        duration: 5,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('Runway create error:', createRes.status, errText.substring(0, 300));
      // Fallback to image
      const finalUrl = `/uploads/${finalImgFilename}`;
      await pool.query(
        `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
        [req.user.id, companionId, '📸', finalUrl]
      );
      // Partial refund (image was created, video failed)
      const refund = TOKEN_COSTS.video - TOKEN_COSTS.image;
      if (refund > 0) await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [refund, req.user.id]);
      return res.json({ image_url: finalUrl, video_url: null, caption: '📸', note: 'Runway error, showing image instead.' });
    }

    const taskData = await createRes.json();
    const taskId = taskData.id;
    console.log(`🎬 Runway task created: ${taskId}`);

    // Poll for result (max 120 seconds)
    let videoUrl = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const pollRes = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${runwayKey}`,
          'X-Runway-Version': '2024-11-06',
        },
      });

      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();

      if (pollData.status === 'SUCCEEDED') {
        videoUrl = pollData.output?.[0] || pollData.output?.video || pollData.artifactUrl;
        // Try various output formats
        if (!videoUrl && Array.isArray(pollData.output)) videoUrl = pollData.output[0];
        if (!videoUrl && pollData.output?.url) videoUrl = pollData.output.url;
        console.log('✅ Runway video completed:', videoUrl?.substring(0, 100));
        break;
      }

      if (pollData.status === 'FAILED') {
        console.error('Runway task failed:', pollData.failure || pollData.failureCode);
        break;
      }

      // Still running
      console.log(`🎬 Runway polling... status: ${pollData.status} (${i + 1}/40)`);
    }

    if (videoUrl) {
      // Download video and save locally
      try {
        const videoRes = await fetch(videoUrl);
        if (videoRes.ok) {
          const videoBuf = Buffer.from(await videoRes.arrayBuffer());
          const videoFilename = `video-${Date.now()}.mp4`;
          fs.writeFileSync(path.join(uploadDir, videoFilename), videoBuf);
          const localVideoUrl = `/uploads/${videoFilename}`;

          await pool.query(
            `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
            [req.user.id, companionId, '🎬', localVideoUrl]
          );

          // Clean up scene image
          try { fs.unlinkSync(path.join(uploadDir, finalImgFilename)); } catch {}

          console.log(`✅ Video saved: ${videoFilename}`);
          return res.json({ video_url: localVideoUrl, caption: '🎬' });
        }
      } catch (e) {
        console.error('Video download error:', e.message);
      }

      // If download failed, return the remote URL
      await pool.query(
        `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'video',$4)`,
        [req.user.id, companionId, '🎬', videoUrl]
      );
      return res.json({ video_url: videoUrl, caption: '🎬' });
    }

    // Video generation failed, fallback to image
    console.log('⚠️ Runway timed out or failed, falling back to image');
    const finalUrl = `/uploads/${finalImgFilename}`;
    await pool.query(
      `INSERT INTO messages (user_id, companion_id, role, content, type, media_url) VALUES ($1,$2,'assistant',$3,'image',$4)`,
      [req.user.id, companionId, '📸', finalUrl]
    );
    const refund = TOKEN_COSTS.video - TOKEN_COSTS.image;
    if (refund > 0) await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [refund, req.user.id]);

    res.json({ image_url: finalUrl, video_url: null, caption: '📸', note: 'Video timed out, showing image.' });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video gen error:', err);
    res.status(500).json({ error: 'Video generation failed' });
  }
});

module.exports = router;
