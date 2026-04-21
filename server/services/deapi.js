const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.DEAPI_BASE_URL || 'https://api.deapi.ai').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(process.env.DEAPI_TIMEOUT_MS || 240000);
const POLL_INTERVAL_MS = Number(process.env.DEAPI_POLL_INTERVAL_MS || 3000);

let modelCache = null;
let modelCacheAt = 0;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

function getHeaders(extra = {}) {
  const apiKey = process.env.DEAPI_API_KEY;
  if (!apiKey) throw new Error('DEAPI_API_KEY is missing');
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    ...extra,
  };
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483647) + 1;
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
  if (typeof model?.type === 'string') return [model.type];
  return [];
}

function inferMime(filename) {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function chooseModel(models, task, preferredSlug) {
  if (preferredSlug) return { slug: preferredSlug, name: preferredSlug, info: {} };

  const filtered = models.filter(m => getInferenceTypes(m).includes(task));
  if (!filtered.length) throw new Error(`No deAPI model available for task: ${task}`);

  const preferredNames = {
    img2img: ['qwenimageedit', 'qwen', 'edit', 'flux'],
    img2video: ['ltx', 'video', 'wan'],
  };

  const byKeyword = (preferredNames[task] || [])
    .map(keyword => filtered.find(m => String(m.slug || m.name || '').toLowerCase().includes(keyword.toLowerCase())))
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

  const base = {
    width: normalizeDimension(defaults.width || process.env.DEAPI_WIDTH || 768, 768, resolutionStep, limits.min_width || 256, limits.max_width || 1536),
    height: normalizeDimension(defaults.height || process.env.DEAPI_HEIGHT || 768, 768, resolutionStep, limits.min_height || 256, limits.max_height || 1536),
    steps: Number(defaults.steps || process.env.DEAPI_STEPS || 30),
    guidance: Number(defaults.guidance || process.env.DEAPI_GUIDANCE || 7.5),
    seed: randomSeed(),
  };

  if (task === 'img2video') {
    base.frames = Number(defaults.frames || process.env.DEAPI_VIDEO_FRAMES || 96);
    base.fps = Number(defaults.fps || process.env.DEAPI_VIDEO_FPS || 24);
  }

  return base;
}

async function listModels(forceRefresh = false) {
  if (!forceRefresh && modelCache && Date.now() - modelCacheAt < MODEL_CACHE_TTL_MS) return modelCache;
  const data = await fetchJson(`${BASE_URL}/api/v1/client/models`, {
    method: 'GET',
    headers: getHeaders(),
  });
  modelCache = extractModels(data);
  modelCacheAt = Date.now();
  return modelCache;
}

async function getModel(task, preferredSlug) {
  if (preferredSlug) return chooseModel([], task, preferredSlug);
  const models = await listModels();
  return chooseModel(models, task, preferredSlug);
}

async function makeImageBlob(imagePath) {
  const buffer = await fs.promises.readFile(imagePath);
  return new Blob([buffer], { type: inferMime(imagePath) });
}

async function submitMultipart(endpoint, form) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
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
    const status = String(job.status || '').toLowerCase();
    const resultUrl = job.result_url || job.output_url || job.url || job.data?.result_url;

    if ((status === 'done' || status === 'completed' || status === 'success') && resultUrl) {
      return resultUrl;
    }
    if (status === 'error' || status === 'failed') {
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

async function img2img({ imagePath, prompt, negativePrompt, seed }) {
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error('img2img imagePath is missing');
  if (!prompt || !String(prompt).trim()) throw new Error('img2img prompt is missing');

  const model = await getModel('img2img', process.env.DEAPI_IMG2IMG_MODEL);
  const params = deriveParamsFromModel(model, 'img2img');
  const finalSeed = Number(seed || params.seed || randomSeed());
  const finalModel = model.slug || model.name;
  const form = new FormData();

  form.append('image', await makeImageBlob(imagePath), path.basename(imagePath));
  form.append('prompt', String(prompt));
  form.append('model', String(finalModel));
  form.append('steps', String(params.steps));
  form.append('seed', String(finalSeed));
  form.append('guidance', String(params.guidance));
  if (negativePrompt) form.append('negative_prompt', String(negativePrompt));

  console.log('deAPI img2img request:', { model: finalModel, seed: finalSeed, hasPrompt: true });

  const requestId = await submitMultipart('/api/v1/client/img2img', form);
  const resultUrl = await waitForResult(requestId, Number(process.env.DEAPI_IMAGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  return {
    ...(await downloadToBuffer(resultUrl)),
    resultUrl,
    model: finalModel,
    requestId,
    seed: finalSeed,
  };
}

async function img2video({ imagePath, prompt, negativePrompt, seed }) {
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error('img2video imagePath is missing');
  if (!prompt || !String(prompt).trim()) throw new Error('img2video prompt is missing');

  const model = await getModel('img2video', process.env.DEAPI_IMG2VIDEO_MODEL);
  const params = deriveParamsFromModel(model, 'img2video');
  const finalSeed = Number(seed || params.seed || randomSeed());
  const finalModel = model.slug || model.name;
  const form = new FormData();

  form.append('first_frame_image', await makeImageBlob(imagePath), path.basename(imagePath));
  form.append('prompt', String(prompt));
  form.append('model', String(finalModel));
  form.append('width', String(params.width));
  form.append('height', String(params.height));
  form.append('guidance', String(params.guidance));
  form.append('steps', String(params.steps));
  form.append('frames', String(params.frames));
  form.append('seed', String(finalSeed));
  form.append('fps', String(params.fps));
  if (negativePrompt) form.append('negative_prompt', String(negativePrompt));

  console.log('deAPI img2video request:', {
    model: finalModel,
    seed: finalSeed,
    width: params.width,
    height: params.height,
    frames: params.frames,
    fps: params.fps,
    hasPrompt: true,
  });

  const requestId = await submitMultipart('/api/v1/client/img2video', form);
  const resultUrl = await waitForResult(requestId, Number(process.env.DEAPI_VIDEO_TIMEOUT_MS || 420000));
  return {
    ...(await downloadToBuffer(resultUrl)),
    resultUrl,
    model: finalModel,
    requestId,
    seed: finalSeed,
  };
}

module.exports = {
  img2img,
  img2video,
  listModels,
};
