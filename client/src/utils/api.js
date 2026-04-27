const API_BASE = import.meta.env.VITE_API_URL || '';

export function getToken() {
  return localStorage.getItem('aura_token');
}

export function setToken(token) {
  localStorage.setItem('aura_token', token);
}

export function removeToken() {
  localStorage.removeItem('aura_token');
}

export async function api(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...options,
      headers,
      body: options.body instanceof FormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw { error: error?.message || 'Network request failed' };
  }

  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw || `Request failed with status ${res.status}` };
  }

  if (!res.ok) {
    throw { status: res.status, ...data };
  }

  return data;
}

// Token costs
export const TOKEN_COSTS = {
  image: 5,
  video: 15,
  voice: 2,
};

export const PLANS = [
  { id: 'starter', name: 'Starter', price: 9.99, messages: 500, companions: 1, tokens: 50, voice: false, images: true, videos: false },
  { id: 'plus', name: 'Plus', price: 19.99, messages: 2000, companions: 3, tokens: 150, voice: true, images: true, videos: true },
  { id: 'premium', name: 'Premium', price: 39.99, messages: 999999, companions: 10, tokens: 500, voice: true, images: true, videos: true },
];

export function getPlanInfo(planId) {
  return PLANS.find(p => p.id === planId);
}

export function getMessagesLeft(user) {
  if (!user) return 0;
  if (user.is_admin) return 999999;
  if (user.plan) {
    const plan = getPlanInfo(user.plan);
    return plan ? Math.max(0, plan.messages - (user.messages_used || 0)) : 0;
  }
  return Math.max(0, 50 - (user.messages_used || 0));
}

export function isTrialExpired(user) {
  if (!user || user.plan || user.is_admin) return false;
  if (!user.trial_start) return false;
  return Date.now() - new Date(user.trial_start).getTime() > 24 * 60 * 60 * 1000;
}

export function getCompanionSlots(user) {
  if (!user) return 0;
  if (user.is_admin) return 999;
  if (user.plan) {
    const plan = getPlanInfo(user.plan);
    return plan?.companions || 1;
  }
  return 1;
}

export function getUserTokens(user) {
  if (!user) return 0;
  if (user.is_admin) return 99999;
  return user.tokens || 0;
}

export function canUseFeature(user, feature) {
  if (!user) return false;
  if (user.is_admin) return true;
  const plan = getPlanInfo(user.plan);
  if (!plan) return false;
  if (feature === 'image') return plan.images && (user.tokens || 0) >= TOKEN_COSTS.image;
  if (feature === 'video') return plan.videos && (user.tokens || 0) >= TOKEN_COSTS.video;
  if (feature === 'voice') return plan.voice && (user.tokens || 0) >= TOKEN_COSTS.voice;
  return false;
}
