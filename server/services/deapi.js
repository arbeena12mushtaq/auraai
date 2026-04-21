const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const BASE_URL = (process.env.DEAPI_BASE_URL || 'https://api.deapi.ai').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(process.env.DEAPI_TIMEOUT_MS || 240000);
const POLL_INTERVAL_MS = Number(process.env.DEAPI_POLL_INTERVAL_MS || 3000);

let modelCache = null;
let modelCacheAt = 0;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

function getHeaders(extra = {}) {
  const apiKey = process.env.DEAPI_API_KEY;
  if (!apiKey) {
    throw new Error('DEAPI_API_KEY is missing');
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    ...extra,
  };
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`deAPI request failed: ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function extractModels(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

function getInferenceTypes(model) {
  if (Array.isArray(model?.inference_types)) return model.inference_types;
  if (Array.isArray(model?.inferenceTypes)) return model.inferenceTypes;
  return [];
}

function inferMime(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function chooseModel(models, task, preferredSlug) {
  if (preferredSlug) {
    const exact = models.find(m => m.slug === preferredSlug || m.name === preferredSlug);
    if (exact) return exact;
  }

  const filtered = models.filter(m => getInferenceTypes(m).includes(task));
  if (!filtered.length) {
    throw new Error(`No deAPI model available for task: ${task}`);
  }

  const preferredNames = {
    img2img: ['QwenImageEdit', 'Qwen', 'Flux', 'Edit'],
    img2video: ['Ltx', 'LTX', 'Wan', 'video'],
  };

  const byKeyword = (preferredNames[task] || [])
    .map(keyword => filtered.find(m => String(m.slug || '').toLowerCase().includes(keyword.toLowerCase())))
    .find(Boolean);

  return byKeyword || filtered[0];
}

function normalizeDimension(value, fallback = 768, step = 32, min = 256, max = 1536) {
  let n = Number(value || fallback);
  if (!Number.isFinite(n) || n <= 0) n = fallback;
  n = Math.max(min, Math.min(max, n));
  return Math.round(n / step) * step;
}

function deriveParamsFromModel(model, task) {
  const limits = model?.info?.limits || {};
  const defaults = model?.info?.defaults || {};
  const resolutionStep = Number(limits.resolution_step || 32);

  const width = normalizeDimension(defaults.width || 768, 768, resolutionStep, limits.min_width || 256, limits.max_width || 1536);
  const height = normalizeDimension(defaults.height || 1024, 1024, resolutionStep, limits.min_height || 256, limits.max_height || 1536);

  const base = {
    width,
    height,
    steps: Number(defaults.steps || Math.min(Number(limits.max_steps || 20), 20) || 20),
    guidance: Number(defaults.guidance || (model?.info?.features?.supports_guidance === false ? 0 : 7.5)),
    seed: randomSeed(),
  };

  if (task === 'img2video') {
    const maxFrames = Number(limits.max_frames || 49);
    const maxFps = Number(limits.max_fps || 12);
    base.frames = Math.min(maxFrames, Number(defaults.frames || 33));
    base.fps = Math.min(maxFps, Number(defaults.fps || 8));
  }

  return base;
}

async function listModels(forceRefresh = false) {
  if (!forceRefresh && modelCache && Date.now() - modelCacheAt < MODEL_CACHE_TTL_MS) {
    return modelCache;
  }

  const data = await fetchJson(`${BASE_URL}/api/v1/client/models`, {
    method: 'GET',
    headers: getHeaders(),
  });

  modelCache = extractModels(data);
  modelCacheAt = Date.now();
  return modelCache;
}

async function getModel(task, preferredSlug) {
  const models = await listModels();
  return chooseModel(models, task, preferredSlug);
}

async function submitMultipart(endpoint, form) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(form.getHeaders()),
    body: form,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`deAPI submit failed: ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  const requestId = data?.data?.request_id || data?.request_id;
  if (!requestId) {
    const err = new Error('deAPI did not return request_id');
    err.body = data;
    throw err;
  }

  return requestId;
}

async function waitForResult(requestId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const data = await fetchJson(`${BASE_URL}/api/v1/client/request-status/${requestId}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    const job = data?.data || data || {};
    const status = job.status;
    if (status === 'done' && job.result_url) return job.result_url;
    if (status === 'error') {
      const err = new Error('deAPI job failed');
      err.body = job;
      throw err;
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('deAPI polling timed out');
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download deAPI result: ${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || '',
  };
}

async function img2img({ imagePath, prompt, negativePrompt }) {
  const model = await getModel('img2img', process.env.DEAPI_IMG2IMG_MODEL);
  const params = deriveParamsFromModel(model, 'img2img');
  const form = new FormData();

  form.append('prompt', prompt);
  form.append('model', model.slug || model.name);
  form.append('steps', String(params.steps));
  form.append('seed', String(params.seed));
  form.append('guidance', String(params.guidance));
  form.append('width', String(params.width));
  form.append('height', String(params.height));
  if (negativePrompt) form.append('negative_prompt', negativePrompt);
  form.append('image', fs.createReadStream(imagePath), {
    filename: path.basename(imagePath),
    contentType: inferMime(imagePath),
  });

  const requestId = await submitMultipart('/api/v1/client/img2img', form);
  const resultUrl = await waitForResult(requestId, Number(process.env.DEAPI_IMAGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  return {
    ...(await downloadToBuffer(resultUrl)),
    resultUrl,
    model: model.slug || model.name,
    requestId,
  };
}

async function img2video({ imagePath, prompt, negativePrompt }) {
  const model = await getModel('img2video', process.env.DEAPI_IMG2VIDEO_MODEL);
  const params = deriveParamsFromModel(model, 'img2video');
  const form = new FormData();

  form.append('prompt', prompt);
  form.append('model', model.slug || model.name);
  form.append('steps', String(params.steps));
  form.append('seed', String(params.seed));
  form.append('guidance', String(params.guidance));
  form.append('width', String(params.width));
  form.append('height', String(params.height));
  form.append('frames', String(params.frames));
  form.append('fps', String(params.fps));
  if (negativePrompt) form.append('negative_prompt', negativePrompt);
  form.append('first_frame_image', fs.createReadStream(imagePath), {
    filename: path.basename(imagePath),
    contentType: inferMime(imagePath),
  });

  const requestId = await submitMultipart('/api/v1/client/img2video', form);
  const resultUrl = await waitForResult(requestId, Number(process.env.DEAPI_VIDEO_TIMEOUT_MS || 420000));
  return {
    ...(await downloadToBuffer(resultUrl)),
    resultUrl,
    model: model.slug || model.name,
    requestId,
  };
}

module.exports = {
  img2img,
  img2video,
  listModels,
};
