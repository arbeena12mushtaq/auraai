const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware, contentFilter } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Build a safe, detailed prompt from companion traits
function buildImagePrompt(data) {
  const {
    category, art_style, ethnicity, age_range, eye_color,
    hair_style, hair_color, body_type, personality, description
  } = data;

  const gender = category === 'Guys' ? 'male' : 'female';
  const style = art_style === 'Anime' ? 'anime art style' : 'photorealistic portrait photograph';

  let prompt = `A beautiful ${style} of a ${gender} person`;

  if (ethnicity) prompt += `, ${ethnicity} ethnicity`;
  if (age_range) prompt += `, appears ${age_range} years old`;
  if (hair_color && hair_style) prompt += `, ${hair_color.toLowerCase()} ${hair_style.toLowerCase()} hair`;
  if (eye_color) prompt += `, ${eye_color.toLowerCase()} eyes`;
  if (body_type) prompt += `, ${body_type.toLowerCase()} build`;
  if (description) prompt += `. ${description}`;

  prompt += '. Soft studio lighting, warm tones, friendly expression, looking at camera, portrait headshot, high quality';

  // Safety: keep it clean
  if (art_style === 'Anime') {
    prompt += ', clean anime art, wholesome, colorful, studio ghibli inspired';
  } else {
    prompt += ', professional portrait, tasteful, fully clothed, natural beauty';
  }

  return prompt;
}

// Strategy 1: Stability AI (stable diffusion)
async function generateWithStabilityAI(prompt) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'image/*',
      },
      body: (() => {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('negative_prompt', 'nsfw, nude, naked, sexual, violence, blood, gore, ugly, deformed');
        formData.append('output_format', 'png');
        formData.append('aspect_ratio', '1:1');
        return formData;
      })(),
    });

    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (err) {
    console.error('Stability AI error:', err.message);
    return null;
  }
}

// Strategy 2: OpenAI DALL-E
async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt + ' Safe for work, no nudity, fully clothed.',
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch (err) {
    console.error('OpenAI DALL-E error:', err.message);
    return null;
  }
}

// Strategy 3: Together AI (affordable, fast)
async function generateWithTogetherAI(prompt) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell-Free',
        prompt: prompt,
        negative_prompt: 'nsfw, nude, naked, sexual, violence, gore, ugly, deformed, bad anatomy',
        width: 768,
        height: 768,
        steps: 4,
        n: 1,
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Together AI response:', err);
      return null;
    }
    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch (err) {
    console.error('Together AI error:', err.message);
    return null;
  }
}

// Strategy 4: Pollinations AI (free, no API key needed)
async function generateWithPollinations(prompt) {
  try {
    const encodedPrompt = encodeURIComponent(prompt + ' Safe for work, fully clothed, portrait photograph.');
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&nologo=true&model=flux`;

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 5000) return null; // too small = error image
    return Buffer.from(buffer);
  } catch (err) {
    console.error('Pollinations error:', err.message);
    return null;
  }
}

// Generate image endpoint
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { category, art_style, ethnicity, age_range, eye_color,
            hair_style, hair_color, body_type, personality, description } = req.body;

    // Content safety check
    if (description && !contentFilter(description)) {
      return res.status(400).json({ error: 'Description contains inappropriate content' });
    }

    const prompt = buildImagePrompt(req.body);
    console.log('🎨 Generating image with prompt:', prompt.substring(0, 100) + '...');

    // Try each provider in order of preference
    let imageBuffer = null;
    let provider = '';

    // 1. Try Stability AI
    imageBuffer = await generateWithStabilityAI(prompt);
    if (imageBuffer) { provider = 'stability'; }

    // 2. Try OpenAI DALL-E
    if (!imageBuffer) {
      imageBuffer = await generateWithOpenAI(prompt);
      if (imageBuffer) { provider = 'openai'; }
    }

    // 3. Try Together AI
    if (!imageBuffer) {
      imageBuffer = await generateWithTogetherAI(prompt);
      if (imageBuffer) { provider = 'together'; }
    }

    // 4. Try Pollinations (free fallback)
    if (!imageBuffer) {
      imageBuffer = await generateWithPollinations(prompt);
      if (imageBuffer) { provider = 'pollinations'; }
    }

    if (!imageBuffer) {
      return res.status(500).json({
        error: 'Image generation unavailable. Please upload an image instead.',
        hint: 'Add OPENAI_API_KEY, STABILITY_API_KEY, or TOGETHER_API_KEY to enable AI image generation.'
      });
    }

    // Save to disk
    const filename = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 8)}.png`;
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, imageBuffer);

    console.log(`✅ Image generated via ${provider}: ${filename} (${Math.round(imageBuffer.length / 1024)}KB)`);

    res.json({
      avatar_url: `/uploads/${filename}`,
      provider,
    });
  } catch (err) {
    console.error('Image generation error:', err);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

module.exports = router;
