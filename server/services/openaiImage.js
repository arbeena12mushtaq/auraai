const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function saveBuffer(prefix, buffer, ext = '.png') {
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), buffer);
  return `/uploads/${filename}`;
}

function toAbsolutePublicUrl(relativeOrAbsolute, req = null) {
  if (!relativeOrAbsolute) return null;
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;

  const envBase = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
  const reqBase = req ? `${req.protocol}://${req.get('host')}`.replace(/\/$/, '') : '';
  const publicBase = envBase || reqBase;

  if (!publicBase) return relativeOrAbsolute;
  return `${publicBase}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`;
}

async function generateAvatarWithOpenAI(prompt, req) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

  console.log('🤖 OpenAI avatar generating:', {
    model,
    promptLength: prompt.length,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
  model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini',
  prompt,
  size: '1024x1024',
  quality: process.env.OPENAI_IMAGE_QUALITY || 'low',
  output_format: 'jpeg',
  n: 1,
}),

    clearTimeout(timer);

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error('❌ OpenAI image error:', response.status, data);
      throw new Error(data?.error?.message || `OpenAI image failed: ${response.status}`);
    }

    const b64 = data?.data?.[0]?.b64_json;
    const imageUrl = data?.data?.[0]?.url;

    if (b64) {
      const buffer = Buffer.from(b64, 'base64');
      const localPath = saveBuffer('avatar-openai', buffer, '.png');
      const publicUrl = toAbsolutePublicUrl(localPath, req);

      return {
        avatar_url: publicUrl,
        avatar_preview_url: publicUrl,
        avatar_source_url: publicUrl,
        provider: 'openai',
        model,
      };
    }

    if (imageUrl) {
      return {
        avatar_url: imageUrl,
        avatar_preview_url: imageUrl,
        avatar_source_url: imageUrl,
        provider: 'openai',
        model,
      };
    }

    throw new Error('OpenAI returned no image');
  } catch (err) {
    clearTimeout(timer);
    console.error('❌ OpenAI avatar failed:', err.message);
    throw err;
  }
}

module.exports = { generateAvatarWithOpenAI };
