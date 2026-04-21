const fs = require('fs');
const path = require('path');

const DEAPI_BASE_URL = process.env.DEAPI_BASE_URL || 'https://api.deapi.ai';
const DEAPI_API_KEY = process.env.DEAPI_API_KEY;

function assertConfigured() {
  if (!DEAPI_API_KEY) {
    const err = new Error('DEAPI_API_KEY is missing');
    err.code = 'DEAPI_NOT_CONFIGURED';
    throw err;
  }
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${DEAPI_API_KEY}`,
    Accept: 'application/json',
    ...extra,
  };
}

async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function deapiFetchJson(endpoint, options = {}) {
  assertConfigured();
  const res = await fetch(`${DEAPI_BASE_URL}${endpoint}`, options);
  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `deAPI request failed (${res.status})`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

async function listModels(inferenceType) {
  const query = new URLSearchParams();
  if (inferenceType) query.set('filter[inference_types]', inferenceType);
  query.set('per_page', '100');

  const data = await deapiFetchJson(`/api/v1/client/models?${query.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
  });

  return Array.isArray(data?.data) ? data.data : [];
}

async function resolveModelSlug(inferenceType, envValue) {
  if (envValue) return envValue;
  const models = await listModels(inferenceType);
  if (!models.length) {
    const err = new Error(`No deAPI models available for ${inferenceType}`);
    err.code = 'DEAPI_NO_MODEL';
    throw err;
  }
  return models[0].slug;
}

function randomSeed() {
  return Math.floor(Math.random() * 2147483646) + 1;
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/png';
}

function appendFile(form, fieldName, filePath) {
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: guessMimeType(filePath) });
  form.append(fieldName, blob, path.basename(filePath));
}

async function submitTxt2Img({ prompt, width = 1024, height = 1024, guidance = 7.5, steps = 4, seed, negativePrompt }) {
  const model = await resolveModelSlug('txt2img', process.env.DEAPI_TXT2IMG_MODEL);
  const data = await deapiFetchJson('/api/v1/client/txt2img', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prompt,
      model,
      width,
      height,
      guidance,
      steps,
      seed: seed || randomSeed(),
      negative_prompt: negativePrompt || 'blurry, distorted, noisy, low quality, deformed hands, extra limbs',
    }),
  });

  return { requestId: data?.data?.request_id, model };
}

async function submitImg2Img({ prompt, imagePath, width, height, guidance = 7.5, steps = 20, seed, negativePrompt }) {
  const model = await resolveModelSlug('img2img', process.env.DEAPI_IMG2IMG_MODEL);
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', model);
  form.append('steps', String(steps));
  form.append('seed', String(seed || randomSeed()));
  form.append('guidance', String(guidance));
  form.append('negative_prompt', negativePrompt || 'blurry, distorted, noisy, low quality, deformed face, different person');
  appendFile(form, 'image', imagePath);
  if (width) form.append('width', String(width));
  if (height) form.append('height', String(height));

  const data = await deapiFetchJson('/api/v1/client/img2img', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  return { requestId: data?.data?.request_id, model };
}

async function submitImg2Video({ prompt, firstFramePath, width = 768, height = 768, guidance = 3, steps = 20, frames = 97, fps = 24, seed, negativePrompt }) {
  const model = await resolveModelSlug('img2video', process.env.DEAPI_IMG2VIDEO_MODEL);
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', model);
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('guidance', String(guidance));
  form.append('steps', String(steps));
  form.append('frames', String(frames));
  form.append('fps', String(fps));
  form.append('seed', String(seed || randomSeed()));
  form.append('negative_prompt', negativePrompt || 'flicker, blur, warped face, extra limbs, jittery motion');
  appendFile(form, 'first_frame_image', firstFramePath);

  const data = await deapiFetchJson('/api/v1/client/img2video', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  return { requestId: data?.data?.request_id, model };
}

async function getRequestStatus(requestId) {
  const data = await deapiFetchJson(`/api/v1/client/request-status/${requestId}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  return data?.data || {};
}

function extractResultUrl(statusData) {
  return (
    statusData?.result_url ||
    statusData?.result ||
    statusData?.results_alt_formats?.mp4 ||
    statusData?.results_alt_formats?.jpg ||
    statusData?.results_alt_formats?.png ||
    statusData?.results_alt_formats?.webp ||
    null
  );
}

async function waitForResult(requestId, { timeoutMs = 180000, intervalMs = 4000 } = {}) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const statusData = await getRequestStatus(requestId);
    const status = String(statusData?.status || '').toLowerCase();
    const resultUrl = extractResultUrl(statusData);

    if (resultUrl && ['completed', 'finished', 'success', 'succeeded'].includes(status)) {
      return { status, resultUrl, raw: statusData };
    }

    if (resultUrl && !status) {
      return { status: 'completed', resultUrl, raw: statusData };
    }

    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      const err = new Error(statusData?.error || statusData?.message || 'deAPI job failed');
      err.code = 'DEAPI_JOB_FAILED';
      err.payload = statusData;
      throw err;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const err = new Error('Timed out waiting for deAPI result');
  err.code = 'DEAPI_TIMEOUT';
  throw err;
}

async function downloadResultToFile(url, targetPath) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Failed to download deAPI result (${res.status})`);
    err.code = 'DEAPI_DOWNLOAD_FAILED';
    throw err;
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.promises.writeFile(targetPath, Buffer.from(arrayBuffer));
  return targetPath;
}

module.exports = {
  assertConfigured,
  listModels,
  resolveModelSlug,
  submitTxt2Img,
  submitImg2Img,
  submitImg2Video,
  waitForResult,
  downloadResultToFile,
  randomSeed,
};
