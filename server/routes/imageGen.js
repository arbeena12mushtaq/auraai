const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function buildImagePrompt(data) {
  const gender = data.category === 'Guys' ? 'male' : 'female';
  const isAnime = data.art_style === 'Anime';

  let prompt = isAnime
    ? `Beautiful anime character portrait, ${gender}`
    : `Professional portrait photograph of a beautiful ${gender} person`;

  if (data.ethnicity) prompt += `, ${data.ethnicity} ethnicity`;
  if (data.age_range) prompt += `, appears ${data.age_range} years old`;
  if (data.hair_color && data.hair_style) prompt += `, ${data.hair_color} ${data.hair_style} hair`;
  if (data.eye_color) prompt += `, ${data.eye_color} eyes`;
  if (data.body_type) prompt += `, ${data.body_type} build`;
  if (data.description) prompt += `. ${data.description}`;

  if (isAnime) {
    prompt += '. Clean anime art style, vibrant colors, detailed eyes, soft lighting, high quality anime illustration, wholesome, fully clothed';
  } else {
    prompt += '. Soft natural lighting, warm tones, friendly confident expression, looking at camera, sharp focus, shallow depth of field, professional headshot, fully clothed, tasteful, attractive';
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

    const prompt = buildImagePrompt(req.body);
    console.log('🎨 Image prompt:', prompt.substring(0, 120) + '...');

    // Try providers in order: OpenAI (you have key) → Together → Stability
    let imageBuffer = null;
    let provider = '';

    imageBuffer = await generateWithOpenAI(prompt);
    if (imageBuffer) provider = 'openai';

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
    console.log(`✅ Saved ${provider} image: ${filename} (${Math.round(imageBuffer.length/1024)}KB)`);

    res.json({ avatar_url: `/uploads/${filename}`, provider });
  } catch (err) {
    console.error('Image gen error:', err);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

module.exports = router;
