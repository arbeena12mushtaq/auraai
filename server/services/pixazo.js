const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const PIXAZO_BASE_URL = (process.env.PIXAZO_BASE_URL || 'https://api.pixazo.ai').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(process.env.PIXAZO_TIMEOUT_MS || 300000);
const POLL_INTERVAL_MS = Number(process.env.PIXAZO_POLL_INTERVAL_MS || 4000);

function getApiKey() {
  const key = process.env.PIXAZO_API_KEY;
  if (!key) throw new Error('PIXAZO_API_KEY is missing');
  return key;
}

function getHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    Accept: 'application/json',
    ...extra,
  };
}

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

async function parseResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Pixazo request failed: ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function normalizeEndpoint(value, fallback) {
  const raw = (value || fallback || '').trim();
  if (!raw) throw new Error('Pixazo endpoint is missing');
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${PIXAZO_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function firstDefined(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '');
}

function extractAssetUrl(payload) {
  return firstDefined(
    payload?.output_url,
    payload?.video_url,
    payload?.image_url,
    payload?.result_url,
    payload?.url,
    payload?.data?.output_url,
    payload?.data?.video_url,
    payload?.data?.image_url,
    payload?.data?.result_url,
    payload?.data?.url,
    payload?.data?.output?.url,
    payload?.output?.url,
    Array.isArray(payload?.data?.outputs) ? payload.data.outputs[0]?.url : undefined,
    Array.isArray(payload?.outputs) ? payload.outputs[0]?.url : undefined,
  );
}

function extractJobId(payload) {
  return firstDefined(
    payload?.request_id,
    payload?.job_id,
    payload?.id,
    payload?.data?.request_id,
    payload?.data?.job_id,
    payload?.data?.id,
  );
}

async function downloadToBuffer(url) {
  const { controller, clear } = withTimeout();
  try {
    const res = await fetch(url, { headers: { Accept: '*/*' }, signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to download Pixazo asset: ${res.status}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || '',
      sourceUrl: url,
    };
  } finally {
    clear();
  }
}

async function pollForResult(statusEndpoint, jobId) {
  const started = Date.now();
  const endpoint = statusEndpoint.replace(/\{id\}/g, encodeURIComponent(jobId));
  while (Date.now() - started < DEFAULT_TIMEOUT_MS) {
    const { controller, clear } = withTimeout();
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: getHeaders(),
        signal: controller.signal,
      });
      const data = await parseResponse(res);
      const status = String(firstDefined(data?.status, data?.data?.status, '')).toLowerCase();
      const assetUrl = extractAssetUrl(data);
      if (assetUrl) return { data, assetUrl };
      if (['failed', 'error'].includes(status)) {
        const err = new Error('Pixazo job failed');
        err.body = data;
        throw err;
      }
    } finally {
      clear();
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Pixazo polling timed out');
}

async function postJson(endpoint, body) {
  const { controller, clear } = withTimeout();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await parseResponse(res);
  } finally {
    clear();
  }
}

async function postMultipart(endpoint, form) {
  const { controller, clear } = withTimeout();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: getHeaders(form.getHeaders()),
      body: form,
      signal: controller.signal,
    });
    return await parseResponse(res);
  } finally {
    clear();
  }
}

async function resolveAssetFromPayload(payload, statusEndpoint) {
  const directUrl = extractAssetUrl(payload);
  if (directUrl) return downloadToBuffer(directUrl);

  const jobId = extractJobId(payload);
  if (!jobId || !statusEndpoint) {
    const err = new Error('Pixazo did not return an asset URL or job id');
    err.body = payload;
    throw err;
  }

  const { assetUrl } = await pollForResult(normalizeEndpoint(statusEndpoint), jobId);
  return downloadToBuffer(assetUrl);
}

async function imageToImage({ imagePath, prompt }) {
  const endpoint = normalizeEndpoint(
    process.env.PIXAZO_IMAGE_ENDPOINT,
    '/v1/image-to-image/nano-banana'
  );
  const statusEndpoint = process.env.PIXAZO_IMAGE_STATUS_ENDPOINT;

  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath), {
    filename: path.basename(imagePath),
    contentType: 'image/png',
  });
  form.append('prompt', prompt);
  form.append('model', process.env.PIXAZO_IMAGE_MODEL || 'nano-banana-pro-async-api');

  const payload = await postMultipart(endpoint, form);
  const file = await resolveAssetFromPayload(payload, statusEndpoint);
  return { ...file, payload, model: process.env.PIXAZO_IMAGE_MODEL || 'nano-banana-pro-async-api' };
}

async function imageToVideo({ imageUrl, prompt }) {
  const endpoint = normalizeEndpoint(
    process.env.PIXAZO_VIDEO_ENDPOINT,
    '/v1/video/generate'
  );
  const statusEndpoint = process.env.PIXAZO_VIDEO_STATUS_ENDPOINT;

  const body = {
    image: imageUrl,
    image_url: imageUrl,
    prompt,
    model: process.env.PIXAZO_VIDEO_MODEL || 'veo-3-1-fast',
    duration: Number(process.env.PIXAZO_VIDEO_DURATION || 5),
    aspect_ratio: process.env.PIXAZO_VIDEO_ASPECT_RATIO || '16:9',
    fps: Number(process.env.PIXAZO_VIDEO_FPS || 24),
    enable_audio: true,
    audio: true,
  };

  const payload = await postJson(endpoint, body);
  const file = await resolveAssetFromPayload(payload, statusEndpoint);
  return { ...file, payload, model: body.model };
}

module.exports = {
  imageToImage,
  imageToVideo,
  downloadToBuffer,
};
