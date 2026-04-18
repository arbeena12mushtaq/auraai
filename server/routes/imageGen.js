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

function getRandomScene() {
  const settings = [
    'at a cozy coffee shop with warm ambient lighting, sitting by the window',
    'at the beach during golden hour, ocean waves in background',
    'in a modern apartment, relaxing on a sofa, soft daylight',
    'at a rooftop restaurant at night, city lights behind',
    'in a garden with blooming flowers, soft sunlight',
    'at a park in autumn, golden leaves, warm afternoon',
    'in a bedroom with morning sunlight through curtains',
    'walking down a cobblestone street at sunset',
    'by a swimming pool, turquoise water, sunny day',
    'in a kitchen cooking, natural window light',
    'at a gym, sporty pose, bright lighting',
    'at a balcony overlooking the ocean, sunset',
    'in a luxury car, leather seats, cinematic lighting',
    'at a festival, colorful lights in background',
  ];
  const outfits = [
    'wearing a casual dress', 'in a top and jeans', 'wearing a cozy sweater',
    'in a summer dress', 'wearing a crop top and skirt', 'in evening wear',
    'wearing a silk blouse', 'in athletic wear', 'wearing a leather jacket',
    'in a cute off-shoulder top', 'wearing a designer outfit',
  ];
  return {
    setting: settings[Math.floor(Math.random() * settings.length)],
    outfit: outfits[Math.floor(Math.random() * outfits.length)],
  };
}

// ===== FREE Face Swap via HuggingFace Spaces (Gradio API) =====
// Uses public face-swap spaces — completely free, no API key needed

async function faceSwapHF(sourceImagePath, targetImagePath) {
  // List of free face swap HF Spaces to try (in order)
  const spaces = [
    'https://felixrosberg-face-swap.hf.space',
    'https://prithivmlmods-face-swap-roop.hf.space',
    'https://tonyassi-face-swap.hf.space',
  ];

  const sourceBuffer = fs.readFileSync(sourceImagePath);
  const targetBuffer = fs.readFileSync(targetImagePath);
  const sourceB64 = sourceBuffer.toString('base64');
  const targetB64 = targetBuffer.toString('base64');

  for (const spaceUrl of spaces) {
    try {
      console.log(`🔄 Trying face swap: ${spaceUrl.split('//')[1].split('.')[0]}...`);

      // Step 1: Submit the job
      const submitRes = await fetch(`${spaceUrl}/gradio_api/call/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            { path: `data:image/png;base64,${sourceB64}` },  // source face
            { path: `data:image/png;base64,${targetB64}` },  // target image
          ]
        }),
      });

      if (!submitRes.ok) {
        // Try alternative endpoint names
        const submitRes2 = await fetch(`${spaceUrl}/gradio_api/call/run_inference`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [
              `data:image/png;base64,${sourceB64}`,
              `data:image/png;base64,${targetB64}`,
            ]
          }),
        });
        if (!submitRes2.ok) {
          console.log(`Face swap ${spaceUrl}: submit failed ${submitRes.status}`);
          continue;
        }
        const eventId2 = (await submitRes2.json()).event_id;
        if (!eventId2) continue;

        // Poll for result
        const resultRes2 = await fetch(`${spaceUrl}/gradio_api/call/run_inference/${eventId2}`);
        if (!resultRes2.ok) continue;
        const resultText2 = await resultRes2.text();
        const dataMatch2 = resultText2.match(/data:\s*(\[.*\])/s);
        if (dataMatch2) {
          const resultData2 = JSON.parse(dataMatch2[1]);
          const outputUrl = resultData2[0]?.url || resultData2[0]?.path || resultData2[0];
          if (outputUrl && typeof outputUrl === 'string') {
            const imgRes = await fetch(outputUrl.startsWith('http') ? outputUrl : `${spaceUrl}/gradio_api/file=${outputUrl}`);
            if (imgRes.ok) {
              console.log('✅ Face swap completed!');
              return Buffer.from(await imgRes.arrayBuffer());
            }
          }
        }
        continue;
      }

      const submitData = await submitRes.json();
      const eventId = submitData.event_id;
      if (!eventId) { console.log('No event_id'); continue; }

      // Step 2: Get result (SSE stream)
      const resultRes = await fetch(`${spaceUrl}/gradio_api/call/predict/${eventId}`);
      if (!resultRes.ok) { console.log('Result fetch failed'); continue; }

      const resultText = await resultRes.text();
      // Parse SSE response - look for data: line with the result
      const dataMatch = resultText.match(/data:\s*(\[.*\])/s);
      if (!dataMatch) { console.log('No data in response'); continue; }

      const resultData = JSON.parse(dataMatch[1]);
      // Result is usually an object with url or path
      const output = resultData[0];
      const outputUrl = output?.url || output?.path || (typeof output === 'string' ? output : null);

      if (outputUrl) {
        const fullUrl = outputUrl.startsWith('http') ? outputUrl : `${spaceUrl}/gradio_api/file=${outputUrl}`;
        const imgRes = await fetch(fullUrl);
        if (imgRes.ok) {
          console.log('✅ Face swap completed!');
          return Buffer.from(await imgRes.arrayBuffer());
        }
      }
    } catch (err) {
      console.log(`Face swap ${spaceUrl} error:`, err.message);
      continue;
    }
  }

  console.log('⚠️ All face swap spaces failed');
  return null;
}

// ===== Pollinations.ai — FREE, no API key, no rate limit, uses Flux =====

async function generateWithPollinations(prompt, width = 1024, height = 1024) {
  try {
    console.log('🌸 Trying Pollinations.ai (free Flux)...');
    const seed = Math.floor(Math.random() * 999999);
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error('Pollinations error:', res.status);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) {
      console.error('Pollinations: not an image response');
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 5000) {
      console.error('Pollinations: image too small, likely error');
      return null;
    }

    console.log(`✅ Pollinations image generated (${Math.round(buffer.length / 1024)}KB)`);
    return buffer;
  } catch (err) {
    console.error('Pollinations error:', err.message);
    return null;
  }
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
        model: 'dall-e-3',
        prompt: prompt + '. Tasteful, appropriate, fully clothed, professional photo.',
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

async function generateVideoWithPixverse(localImagePath, prompt, publicBaseUrl) {
  const apiKey = process.env.PIXVERSE_API_KEY;
  if (!apiKey) { console.log('⚠️ No PIXVERSE_API_KEY'); return null; }

  try {
    console.log('🎬 Trying Pixverse image-to-video...');

    const fullPath = path.join(uploadDir, path.basename(localImagePath));
    if (!fs.existsSync(fullPath)) {
      console.error('Pixverse: image file not found:', fullPath);
      return null;
    }

    // Upload image using image_url (public URL of the image on our server)
    const imagePublicUrl = `${publicBaseUrl}/uploads/${path.basename(localImagePath)}`;
    console.log('🎬 Pixverse uploading from URL:', imagePublicUrl);

    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('image_url', imagePublicUrl);

    const uploadRes = await fetch('https://app-api.pixverse.ai/openapi/v2/image/upload', {
      method: 'POST',
      headers: { 'API-KEY': apiKey },
      body: formData,
    });

    let uploadData;
    if (!uploadRes.ok) {
      // Try direct file upload as fallback
      console.log('🎬 URL upload failed, trying file upload...');
      const formData2 = new FormData();
      const fileStream = fs.createReadStream(fullPath);
      formData2.append('image', fileStream, { filename: 'scene.png', contentType: 'image/png' });

      const uploadRes2 = await fetch('https://app-api.pixverse.ai/openapi/v2/image/upload', {
        method: 'POST',
        headers: { 'API-KEY': apiKey },
        body: formData2,
      });

      if (!uploadRes2.ok) {
        console.error('Pixverse file upload error:', uploadRes2.status, (await uploadRes2.text()).substring(0, 200));
        return null;
      }
      uploadData = await uploadRes2.json();
    } else {
      uploadData = await uploadRes.json();
    }

    const imgId = uploadData.Resp?.img_id || uploadData.Resp?.id;
    if (!imgId) { console.error('Pixverse: no img_id', JSON.stringify(uploadData).substring(0, 200)); return null; }

    console.log(`🎬 Pixverse image uploaded, id: ${imgId}`);

    const genRes = await fetch('https://app-api.pixverse.ai/openapi/v2/video/img/generate', {
      method: 'POST',
      headers: { 'API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duration: 5, img_id: imgId, model: 'v5.6',
        motion_mode: 'normal', quality: '540p',
        prompt: prompt || 'gentle smile, subtle movement, soft breeze',
        negative_prompt: 'fast movement, distortion, blur',
      }),
    });

    if (!genRes.ok) {
      console.error('Pixverse generate error:', genRes.status, (await genRes.text()).substring(0, 200));
      return null;
    }

    const genData = await genRes.json();
    const videoId = genData.Resp?.id;
    if (!videoId) { console.error('Pixverse: no video id'); return null; }

    console.log(`🎬 Pixverse video started, id: ${videoId}`);

    // Poll for result
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://app-api.pixverse.ai/openapi/v2/video/${videoId}`, {
        headers: { 'API-KEY': apiKey },
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const video = pollData.Resp;

      if (video?.status === 1 && video?.url) {
        console.log('✅ Pixverse video completed');
        const videoRes = await fetch(video.url);
        if (videoRes.ok) return Buffer.from(await videoRes.arrayBuffer());
        return video.url;
      }
      if (video?.status === 4 || video?.status === 6) {
        console.error('Pixverse video failed');
        return null;
      }
      console.log(`🎬 Pixverse polling... (${i + 1}/40)`);
    }
    return null;
  } catch (err) { console.error('Pixverse error:', err.message); return null; }
}

// ===== Runway fallback =====

async function generateVideoWithRunway(imageBuffer, prompt) {
  const runwayKey = process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY;
  if (!runwayKey) return null;
  try {
    console.log('🎬 Trying Runway fallback...');
    const dataUri = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    const createRes = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${runwayKey}`, 'X-Runway-Version': '2024-11-06' },
      body: JSON.stringify({ model: 'gen4_turbo', promptImage: dataUri, promptText: prompt, ratio: '720:1280', duration: 5 }),
    });
    if (!createRes.ok) { console.error('Runway error:', createRes.status); return null; }
    const taskData = await createRes.json();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskData.id}`, {
        headers: { 'Authorization': `Bearer ${runwayKey}`, 'X-Runway-Version': '2024-11-06' },
      });
      if (!pollRes.ok) continue;
      const p = await pollRes.json();
      if (p.status === 'SUCCEEDED') { const url = p.output?.[0]; if (url) { const r = await fetch(url); if (r.ok) return Buffer.from(await r.arrayBuffer()); } return null; }
      if (p.status === 'FAILED') return null;
    }
    return null;
  } catch (err) { console.error('Runway error:', err.message); return null; }
}

// ===== ROUTES =====

// Avatar creation (FREE via Pollinations)
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
      prompt = `beautiful anime character portrait, ${gender}, ${desc}, clean anime art style, vibrant colors, detailed eyes, soft lighting, elegant casual outfit, high quality illustration`;
    } else {
      prompt = `photorealistic portrait photograph of a ${gender}, ${desc}, professional photography, 85mm lens, natural lighting, genuine smile, casual clothing, high resolution, detailed skin texture, sharp focus`;
    }

    console.log('🎨 Avatar prompt:', prompt.substring(0, 100) + '...');

    // Try Pollinations first (free), then DALL-E fallback
    let imageBuffer = await generateWithPollinations(prompt);
    let provider = imageBuffer ? 'pollinations-flux' : '';

    if (!imageBuffer) {
      imageBuffer = await generateWithOpenAI(prompt);
      if (imageBuffer) provider = 'openai';
    }

    if (!imageBuffer) {
      return res.status(500).json({ error: 'Image generation unavailable. Upload manually.' });
    }

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    fs.writeFileSync(path.join(uploadDir, filename), imageBuffer);
    console.log(`✅ Avatar: ${filename} (${provider}, ${Math.round(imageBuffer.length / 1024)}KB)`);

    res.json({ avatar_url: `/uploads/${filename}`, provider });
  } catch (err) {
    console.error('Avatar gen error:', err);
    res.status(500).json({ error: 'Failed to generate avatar' });
  }
});

// Scene photo (costs tokens)
router.post('/generate-scene', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.image, 'image_gen', `Photo of ${companion.name}`);

    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const isAnime = companion.art_style === 'Anime';
    const { setting, outfit } = getRandomScene();
    const desc = (companion.description || '').replace(/\b(sexy|hot|nude|naked|nsfw|explicit|busty|thicc|seductive|succubus|demon)\b/gi, '').trim();

    let prompt;
    if (isAnime) {
      prompt = `beautiful anime ${gender}, ${desc}, ${setting}, ${outfit}, anime art style, vibrant colors, detailed, high quality illustration`;
    } else {
      prompt = `photorealistic photograph of a ${gender}, ${desc}, ${setting}, ${outfit}, professional photography, natural lighting, high resolution, candid pose, detailed skin texture`;
    }

    console.log('📸 Scene prompt:', prompt.substring(0, 100) + '...');

    let imageBuffer = await generateWithPollinations(prompt);
    let provider = imageBuffer ? 'pollinations-flux' : '';

    if (!imageBuffer) {
      imageBuffer = await generateWithOpenAI(prompt);
      if (imageBuffer) provider = 'openai';
    }

    if (!imageBuffer) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.image, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    // Face swap: put the avatar's face onto the scene image (FREE via HF Spaces)
    if (companion.avatar_url && !isAnime) {
      const avatarPath = path.join(uploadDir, path.basename(companion.avatar_url));
      if (fs.existsSync(avatarPath)) {
        const tempScenePath = path.join(uploadDir, `temp-scene-${Date.now()}.png`);
        fs.writeFileSync(tempScenePath, imageBuffer);
        const swappedBuffer = await faceSwapHF(avatarPath, tempScenePath);
        if (swappedBuffer) {
          imageBuffer = swappedBuffer;
          provider += '+faceswap';
          console.log('✅ Face swapped onto scene');
        } else {
          console.log('⚠️ Face swap failed, using original scene');
        }
        try { fs.unlinkSync(tempScenePath); } catch {}
      }
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
    console.error('Scene gen error:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// Video (costs tokens)
router.post('/generate-video', authMiddleware, async (req, res) => {
  try {
    const { companionId } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });

    const comp = await pool.query('SELECT * FROM companions WHERE id = $1', [companionId]);
    if (comp.rows.length === 0) return res.status(404).json({ error: 'Companion not found' });
    const companion = comp.rows[0];

    await deductTokens(req.user.id, TOKEN_COSTS.video, 'video_gen', `Video of ${companion.name}`);

    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const isAnime = companion.art_style === 'Anime';
    const { setting, outfit } = getRandomScene();
    const desc = (companion.description || '').replace(/\b(sexy|hot|nude|naked|nsfw|explicit|succubus|demon)\b/gi, '').trim();

    let prompt;
    if (isAnime) {
      prompt = `anime ${gender}, ${desc}, ${setting}, ${outfit}, anime art, vibrant, high quality`;
    } else {
      prompt = `photorealistic ${gender}, ${desc}, ${setting}, ${outfit}, professional photography, natural lighting, high resolution`;
    }

    // Step 1: Generate scene image
    let sceneBuffer = await generateWithPollinations(prompt);
    if (!sceneBuffer) sceneBuffer = await generateWithOpenAI(prompt);

    if (!sceneBuffer) {
      await pool.query('UPDATE users SET tokens = tokens + $1 WHERE id = $2', [TOKEN_COSTS.video, req.user.id]);
      return res.status(500).json({ error: 'Image generation failed. Tokens refunded.' });
    }

    const sceneFilename = `vscene-${Date.now()}.png`;
    fs.writeFileSync(path.join(uploadDir, sceneFilename), sceneBuffer);

    // Step 2: Convert to video (Pixverse → Runway → fallback to image)
    const motionPrompt = `${gender} gently smiling, subtle natural movement, cinematic`;
    const publicBaseUrl = process.env.CLIENT_URL || `https://${req.headers.host}`;

    let videoBuffer = await generateVideoWithPixverse(`/uploads/${sceneFilename}`, motionPrompt, publicBaseUrl);
    if (!videoBuffer) videoBuffer = await generateVideoWithRunway(sceneBuffer, motionPrompt);

    if (videoBuffer) {
      let videoUrl;
      if (Buffer.isBuffer(videoBuffer)) {
        const videoFilename = `video-${Date.now()}.mp4`;
        fs.writeFileSync(path.join(uploadDir, videoFilename), videoBuffer);
        videoUrl = `/uploads/${videoFilename}`;
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

    res.json({ image_url: imageUrl, video_url: null, caption: '📸', note: 'Video API unavailable. Showing image. Partial refund applied.' });
  } catch (err) {
    if (err.code === 'NO_TOKENS') return res.status(403).json(err);
    console.error('Video gen error:', err);
    res.status(500).json({ error: 'Video generation failed' });
  }
});

module.exports = router;
