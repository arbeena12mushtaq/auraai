const DEFAULT_TIMEOUT_MS = Number(process.env.PIXAZO_TIMEOUT_MS || 300000);
const POLL_INTERVAL_MS = Number(process.env.PIXAZO_POLL_INTERVAL_MS || 5000);
const STATUS_ENDPOINT = process.env.PIXAZO_STATUS_ENDPOINT || 'https://gateway.pixazo.ai/v2/requests/status/{request_id}';
const DEFAULT_IMAGE_ENDPOINT = process.env.PIXAZO_IMAGE_ENDPOINT || 'https://gateway.pixazo.ai/nano-banana-2/v1/nano-banana-2/generate';
const DEFAULT_VIDEO_ENDPOINT = process.env.PIXAZO_VIDEO_ENDPOINT || 'https://gateway.pixazo.ai/runway-gen-4-5/v1/gen-4.5/generate';
const OFFICIAL_IMAGE_ENDPOINT = 'https://gateway.pixazo.ai/nano-banana-2/v1/nano-banana-2/generate';
const OFFICIAL_VIDEO_ENDPOINT = 'https://gateway.pixazo.ai/runway-gen-4-5/v1/gen-4.5/generate';

function getApiKey() {
  const key = process.env.PIXAZO_API_KEY;
  if (!key) throw new Error('PIXAZO_API_KEY is missing');
  return key;
}

function getHeaders(extra = {}) {
  const key = getApiKey();
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Ocp-Apim-Subscription-Key': key,
    ...extra,
  };
}

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

async function parseJsonResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const message = data?.message || data?.error || `Pixazo request failed: ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function extractMediaUrl(payload) {
  const candidates = [
    payload?.output?.media_url?.[0],
    payload?.output?.url,
    typeof payload?.output === 'string' ? payload.output : null,  // only if output is a URL string
    payload?.output_url,
    payload?.video_url,
    payload?.image_url,
    payload?.media_url?.[0],
    payload?.url,
  ];
  return candidates.find(c => typeof c === 'string' && c.startsWith('http')) || null;
}

function extractDataUri(payload) {
  return payload?.output?.data_uri
    || payload?.data_uri
    || payload?.image
    || null;
}

function decodeDataUri(dataUri) {
  const match = String(dataUri || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    buffer: Buffer.from(match[2], 'base64'),
    contentType: match[1],
    sourceUrl: null,
  };
}

async function postJson(endpoint, body) {
  const { controller, clear } = withTimeout();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await parseJsonResponse(res);
  } finally {
    clear();
  }
}

async function getJson(url) {
  const { controller, clear } = withTimeout();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'Ocp-Apim-Subscription-Key': getApiKey(),
      },
      signal: controller.signal,
    });
    return await parseJsonResponse(res);
  } finally {
    clear();
  }
}


function isNotFoundError(err) {
  const message = String(err?.message || '').toLowerCase();
  return err?.status === 404 || message.includes('resource not found') || message.includes('not found');
}

async function postJsonWithFallback(endpoints, body, label) {
  let lastErr;
  const unique = [...new Set((Array.isArray(endpoints) ? endpoints : [endpoints]).filter(Boolean))];
  for (const endpoint of unique) {
    try {
      console.log(`🌐 Pixazo ${label} endpoint: ${endpoint}`);
      return await postJson(endpoint, body);
    } catch (err) {
      lastErr = err;
      console.error(`❌ Pixazo ${label} endpoint failed: ${endpoint}`, {
        message: err?.message,
        status: err?.status,
        body: err?.body,
      });
      if (!isNotFoundError(err)) throw err;
    }
  }
  throw lastErr || new Error(`No working Pixazo ${label} endpoint found`);
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

function statusUrlFor(requestId, pollingUrl) {
  if (pollingUrl) return pollingUrl;
  return STATUS_ENDPOINT.replace('{request_id}', encodeURIComponent(requestId));
}

async function pollForCompletion(requestId, pollingUrl) {
  const started = Date.now();
  const url = statusUrlFor(requestId, pollingUrl);
  while (Date.now() - started < DEFAULT_TIMEOUT_MS) {
    const data = await getJson(url);
    const status = String(data?.status || '').toUpperCase();
    if (status === 'COMPLETED' || status === 'SUCCEEDED') {
      const mediaUrl = extractMediaUrl(data);
      if (!mediaUrl) {
        const err = new Error('Pixazo completed without media URL');
        err.body = data;
        throw err;
      }
      return mediaUrl;
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
      const err = new Error(`Pixazo job failed: ${data?.error || data?.message || 'Unknown error'}`);
      err.body = data;
      throw err;
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Pixazo polling timed out');
}

async function imageToImage({ imageUrl, prompt }) {
  if (!imageUrl) throw new Error('imageUrl is required for Pixazo image-to-image');

  // Nano Banana 2 API format (always async — no sync_mode)
  const body = {
    prompt,
    image_input: [imageUrl],                                       // was: image_urls
    aspect_ratio: process.env.PIXAZO_IMAGE_ASPECT_RATIO || '16:9',
    resolution: process.env.PIXAZO_IMAGE_RESOLUTION || '2K',
    output_format: process.env.PIXAZO_IMAGE_OUTPUT_FORMAT || 'png',
    // Removed: sync_mode, num_images, limit_generations (not in new API)
  };

  console.log('📤 Pixazo image request body:', JSON.stringify(body, null, 2));
  const payload = await postJsonWithFallback([DEFAULT_IMAGE_ENDPOINT, OFFICIAL_IMAGE_ENDPOINT], body, 'image');
  console.log('📥 Pixazo image response:', JSON.stringify(payload, null, 2));

  // Nano Banana 2 always returns request_id + polling_url (async only)
  const requestId = payload?.request_id;
  if (!requestId) {
    // Fallback: check if there's a direct media URL (shouldn't happen with new API)
    const immediateMediaUrl = extractMediaUrl(payload);
    if (immediateMediaUrl) {
      const file = await downloadToBuffer(immediateMediaUrl);
      return { ...file, payload, model: 'nano-banana-2', endpoint: DEFAULT_IMAGE_ENDPOINT, sourceUrl: immediateMediaUrl };
    }
    const err = new Error('Pixazo image request did not return request_id or direct output');
    err.body = payload;
    throw err;
  }

  const mediaUrl = await pollForCompletion(requestId, payload?.polling_url);
  const file = await downloadToBuffer(mediaUrl);
  return { ...file, payload, model: 'nano-banana-2', endpoint: DEFAULT_IMAGE_ENDPOINT, sourceUrl: mediaUrl };
}

async function imageToVideo({ imageUrl, prompt }) {
  if (!imageUrl) throw new Error('imageUrl is required for Pixazo Runway image-to-video');
  const duration = Number(process.env.PIXAZO_VIDEO_DURATION || 5);
  if (![5, 10].includes(duration)) throw new Error('PIXAZO_VIDEO_DURATION must be 5 or 10 for Runway Gen-4.5');

  const seedRaw = process.env.PIXAZO_VIDEO_SEED;
  const body = {
    prompt,
    image: imageUrl,
    duration,
    aspect_ratio: process.env.PIXAZO_VIDEO_ASPECT_RATIO || '16:9',
  };
  if (seedRaw !== undefined && seedRaw !== '') body.seed = Number(seedRaw);

  const payload = await postJsonWithFallback([DEFAULT_VIDEO_ENDPOINT, OFFICIAL_VIDEO_ENDPOINT], body, 'video');
  const requestId = payload?.request_id;
  if (!requestId) {
    const err = new Error('Runway request did not return request_id');
    err.body = payload;
    throw err;
  }
  const mediaUrl = await pollForCompletion(requestId, payload?.polling_url);
  const file = await downloadToBuffer(mediaUrl);
  return { ...file, payload, model: 'runway-gen-4-5', endpoint: DEFAULT_VIDEO_ENDPOINT, sourceUrl: mediaUrl };
}

module.exports = { imageToImage, imageToVideo };
