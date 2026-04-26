/**
 * Nano Banana 2 (Gemini 3.1 Flash Image) — Google's native image generation API
 * with built-in identity/subject preservation.
 *
 * Used for:
 *  - Avatar generation (text-to-image)
 *  - Scene generation (image-to-image with identity lock)
 */

const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 120000);

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is missing — get one at https://aistudio.google.com/apikey');
  return key;
}

/**
 * Text-to-image: Generate an avatar from a text prompt
 */
async function generateAvatar({ prompt, aspectRatio = '1:1', resolution = '1K' }) {
  const apiKey = getApiKey();
  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio,
        imageSize: resolution,
      },
    },
  };

  console.log('🍌 Nano Banana avatar request:', { model: GEMINI_MODEL, promptLength: prompt.length, aspectRatio, resolution });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || `Gemini API error: ${res.status}`;
      console.error('🍌 Nano Banana avatar error:', errMsg, data?.error);
      const err = new Error(errMsg);
      err.status = res.status;
      err.body = data;
      throw err;
    }

    // Extract image from response parts
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        const mimeType = part.inlineData.mimeType || 'image/png';
        console.log(`✅ Nano Banana avatar generated: ${buffer.length} bytes, ${mimeType}`);
        return { buffer, mimeType, model: GEMINI_MODEL };
      }
    }

    // No image in response
    const textParts = parts.filter(p => p.text).map(p => p.text).join(' ');
    throw new Error(`Nano Banana returned no image. Text response: ${textParts.slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Image-to-image: Generate a scene from an avatar with identity preservation
 * Sends the avatar as inline base64 + a text prompt describing the new scene
 */
async function generateScene({ imageBuffer, imageMimeType, prompt, aspectRatio = '9:16', resolution = '2K' }) {
  const apiKey = getApiKey();
  const url = `${GEMINI_API_URL}?key=${apiKey}`;

  const base64Image = imageBuffer.toString('base64');

  const body = {
    contents: [{
      parts: [
        {
          inlineData: {
            mimeType: imageMimeType || 'image/jpeg',
            data: base64Image,
          }
        },
        { text: prompt }
      ]
    }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio,
        imageSize: resolution,
      },
    },
  };

  console.log('🍌 Nano Banana scene request:', {
    model: GEMINI_MODEL,
    imageSize: `${Math.round(imageBuffer.length / 1024)}KB`,
    promptLength: prompt.length,
    aspectRatio,
    resolution,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || `Gemini API error: ${res.status}`;
      console.error('🍌 Nano Banana scene error:', errMsg, data?.error);
      const err = new Error(errMsg);
      err.status = res.status;
      err.body = data;
      throw err;
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        const mimeType = part.inlineData.mimeType || 'image/png';
        console.log(`✅ Nano Banana scene generated: ${buffer.length} bytes, ${mimeType}`);
        return { buffer, mimeType, model: GEMINI_MODEL };
      }
    }

    const textParts = parts.filter(p => p.text).map(p => p.text).join(' ');
    throw new Error(`Nano Banana scene returned no image. Text response: ${textParts.slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download an image from a URL and return as buffer
 */
async function downloadImage(imageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(imageUrl, {
      headers: { Accept: 'image/*,*/*;q=0.8' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { buffer, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generateAvatar, generateScene, downloadImage };
