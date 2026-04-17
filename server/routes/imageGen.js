const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function buildImagePrompt(data) {
  const gender = data.category === 'Guys' ? 'man' : 'woman';
  const isAnime = data.art_style === 'Anime';
  const desc = (data.description || '').trim();

  // Strip unsafe words but keep fantasy terms
  const safeDesc = desc
    .replace(/\b(sexy|hot|nude|naked|nsfw|explicit|busty|thicc)\b/gi, '')
    .trim();

  let prompt = '';

  if (isAnime) {
    prompt = `Anime character portrait of a ${gender}. ${safeDesc}. Clean modern anime art, vibrant colors, detailed eyes, soft lighting, high quality digital illustration, casual outfit`;
  } else {
    prompt = `Professional portrait photograph of a ${gender}. ${safeDesc}. Soft natural lighting, warm colors, genuine expression, looking at camera, sharp focus, high quality photograph`;
  }

  return prompt;
}

// OpenAI DALL-E 3
async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.log('No OPENAI_API_KEY'); return null; }

  try {
    console.log('🎨 Calling OpenAI DALL-E...');
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt + '. Safe for work, no nudity, fully clothed, portrait only.',
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'b64_json',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('DALL-E error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) { console.error('DALL-E: no image data in response'); return null; }
    console.log('✅ DALL-E image generated');
    return Buffer.from(b64, 'base64');
  } catch (err) {
    console.error('DALL-E fetch error:', err.message);
    return null;
  }
}

// Together AI FLUX (cheap backup)
async function generateWithTogetherAI(prompt) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return null;

  try {
    console.log('🎨 Calling Together AI...');
    const res = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell-Free',
        prompt: prompt,
        negative_prompt: 'nsfw, nude, naked, sexual, violence, gore, ugly, deformed',
        width: 768, height: 768, steps: 4, n: 1,
        response_format: 'b64_json',
      }),
    });

    if (!res.ok) {
      console.error('Together AI error:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    console.log('✅ Together AI image generated');
    return Buffer.from(b64, 'base64');
  } catch (err) {
    console.error('Together AI error:', err.message);
    return null;
  }
}

// Stability AI
async function generateWithStabilityAI(prompt) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) return null;

  try {
    console.log('🎨 Calling Stability AI...');
    const formData = new URLSearchParams();
    formData.append('prompt', prompt);
    formData.append('negative_prompt', 'nsfw nude naked sexual violence gore ugly deformed');
    formData.append('output_format', 'png');

    const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'image/*' },
      body: formData,
    });

    if (!res.ok) {
      console.error('Stability error:', res.status);
      return null;
    }

    const buffer = await res.arrayBuffer();
    console.log('✅ Stability AI image generated');
    return Buffer.from(buffer);
  } catch (err) {
    console.error('Stability error:', err.message);
    return null;
  }
}

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    if (req.body.description && !contentFilter(req.body.description)) {
      return res.status(400).json({ error: 'Description contains inappropriate content' });
    }

    if (!req.body.description?.trim()) {
      return res.status(400).json({ error: 'Please provide a description to generate an avatar.' });
    }

    const prompt = buildImagePrompt(req.body);
    console.log('🎨 Image prompt:', prompt.substring(0, 120) + '...');

    // Try providers in order: OpenAI → Together → Stability
    let imageBuffer = null;
    let provider = '';

    imageBuffer = await generateWithOpenAI(prompt);
    if (imageBuffer) provider = 'openai';

    // If DALL-E rejected for safety, retry with simpler prompt
    if (!imageBuffer && process.env.OPENAI_API_KEY) {
      const gender = req.body.category === 'Guys' ? 'man' : 'woman';
      const simplePrompt = `Professional headshot photograph of a friendly young ${gender}, smiling, casual clothing, neutral studio background, soft lighting, high quality portrait`;
      console.log('🔄 Retrying DALL-E with simplified prompt...');
      imageBuffer = await generateWithOpenAI(simplePrompt);
      if (imageBuffer) provider = 'openai-retry';
    }

    if (!imageBuffer) {
      imageBuffer = await generateWithTogetherAI(prompt);
      if (imageBuffer) provider = 'together';
    }

    if (!imageBuffer) {
      imageBuffer = await generateWithStabilityAI(prompt);
      if (imageBuffer) provider = 'stability';
    }

    if (!imageBuffer) {
      return res.status(500).json({
        error: 'Image generation unavailable. Please upload an image instead.',
        hint: 'Check that your OPENAI_API_KEY is valid and has DALL-E access.',
      });
    }

    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, imageBuffer);
    console.log(`✅ Saved ${provider} image: ${filename} (${Math.round(imageBuffer.length / 1024)}KB)`);

    res.json({ avatar_url: `/uploads/${filename}`, provider });
  } catch (err) {
    console.error('Image gen error:', err);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

module.exports = router;
