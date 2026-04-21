const fs = require('fs');
const path = require('path');

const POLLINATIONS_BASE_URL = process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai';
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || '';
const DEFAULT_VIDEO_MODEL = process.env.POLLINATIONS_VIDEO_MODEL || 'seedance';

function assertPollinationsConfigured() {
  if (!POLLINATIONS_API_KEY) {
    throw { code: 'POLLINATIONS_NOT_CONFIGURED', error: 'POLLINATIONS_API_KEY is missing' };
  }
}

function buildHeaders() {
  return {
    Authorization: `Bearer ${POLLINATIONS_API_KEY}`,
    Accept: '*/*',
  };
}

function buildVideoUrl({ prompt, model = DEFAULT_VIDEO_MODEL, width = 720, height = 1280, seed, duration = 5, enhance = true, safe = false, negativePrompt = '' }) {
  const cleanPrompt = encodeURIComponent(prompt);
  const url = new URL(`${POLLINATIONS_BASE_URL.replace(/\/$/, '')}/image/${cleanPrompt}`);
  url.searchParams.set('model', model);
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(height));
  url.searchParams.set('duration', String(duration));
  url.searchParams.set('aspectRatio', width >= height ? '16:9' : '9:16');
  url.searchParams.set('enhance', enhance ? 'true' : 'false');
  url.searchParams.set('safe', safe ? 'true' : 'false');
  if (typeof seed === 'number' && Number.isFinite(seed)) url.searchParams.set('seed', String(seed));
  if (negativePrompt) url.searchParams.set('negative_prompt', negativePrompt);
  return url.toString();
}

async function generateVideoToFile({ prompt, outputPath, model, width, height, seed, duration, enhance, safe, negativePrompt }) {
  assertPollinationsConfigured();

  const videoUrl = buildVideoUrl({ prompt, model, width, height, seed, duration, enhance, safe, negativePrompt });
  const response = await fetch(videoUrl, { headers: buildHeaders() });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw {
      code: 'POLLINATIONS_VIDEO_FAILED',
      error: `Pollinations video request failed with ${response.status}`,
      payload: text,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, buffer);

  return {
    model: model || DEFAULT_VIDEO_MODEL,
    outputPath,
    sourceUrl: videoUrl,
  };
}

module.exports = {
  assertPollinationsConfigured,
  buildVideoUrl,
  generateVideoToFile,
};
