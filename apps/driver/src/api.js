import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

let tokens = null;
let onLogout = () => {};
export const setLogoutHandler = (fn) => { onLogout = fn; };

export async function loadTokens() {
  try { const s = await SecureStore.getItemAsync('tokens'); tokens = s ? JSON.parse(s) : null; } catch (e) { tokens = null; }
  return tokens;
}
export async function saveTokens(t) {
  tokens = t;
  try { if (t) await SecureStore.setItemAsync('tokens', JSON.stringify(t)); else await SecureStore.deleteItemAsync('tokens'); } catch (e) { /* ignore */ }
}

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const NO_NET = 'No connection. Check your network and try again.';

async function raw(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(API_URL + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, (j.error && j.error.message) || 'Request failed', j.error && j.error.details);
    return j;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, NO_NET);
  } finally { clearTimeout(timer); }
}

let refreshing = null;
async function refreshTokens() {
  const r = await raw('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } });
  await saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
}
// Retries once after refreshing an expired access token; signs the driver out if the session is gone.
export async function api(path, opts) {
  try { return await raw(path, opts); } catch (e) {
    if (e.status === 401 && tokens && tokens.refreshToken && path !== '/drivers/login') {
      try { refreshing = refreshing || refreshTokens(); await refreshing; } catch (err) { await saveTokens(null); onLogout(); throw e; } finally { refreshing = null; }
      return raw(path, opts);
    }
    throw e;
  }
}

export const login = (phone, pin) => api('/drivers/login', { method: 'POST', body: { phone, pin } });
export const me = () => api('/drivers/me');
export const startShift = (body) => api('/drivers/shifts/start', { method: 'POST', body });
export const endShift = (body) => api('/drivers/shifts/end', { method: 'POST', body });
export const pingLocation = (lat, lng, speed) => api('/drivers/location', { method: 'POST', body: { lat, lng, ...(speed != null ? { speed } : {}) } });
export const currentOffer = () => api('/drivers/offers/current');
export const acceptOffer = (id) => api(`/drivers/offers/${id}/accept`, { method: 'POST' });
export const declineOffer = (id) => api(`/drivers/offers/${id}/decline`, { method: 'POST' });
export const currentTrip = () => api('/drivers/trips/current');
export const startTrip = (id) => api(`/bookings/${id}/start`, { method: 'POST' });
export const completeTrip = (id) => api(`/bookings/${id}/complete`, { method: 'POST' });
export const pickupParcel = (id, photo_url) => api(`/parcels/${id}/pickup`, { method: 'POST', body: { photo_url } });
export const deliverParcel = (id, otp, photo_url) => api(`/parcels/${id}/deliver`, { method: 'POST', body: { otp, photo_url } });
export const earnings = () => api('/drivers/earnings');

export const updateMe = (body) => api('/users/me', { method: 'PATCH', body });
export const clearPushToken = () => api('/users/me/push-token', { method: 'DELETE' });

// Uploads a photo taken on the phone to the backend and returns its URL path (e.g. "/uploads/ab12.jpg").
export async function uploadPhoto(uri) {
  const attempt = async () => {
    const blob = await (await fetch(uri)).blob();
    const r = await fetch(API_URL + '/uploads', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/jpeg', Authorization: `Bearer ${tokens.accessToken}` },
      body: blob,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, (j.error && j.error.message) || 'Photo upload failed', j.error && j.error.details);
    return j.url;
  };
  try { return await attempt(); } catch (e) {
    if (e.status === 401 && tokens) { await refreshTokens(); return attempt(); }
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'Photo upload failed. Check your connection and try again.');
  }
}

export const errorText = (e) => {
  const d = e.details && e.details.missing ? ` Missing: ${e.details.missing.join(', ')}.` : '';
  return (e.message || 'Something went wrong') + d;
};

export const getRoute = (a, b) => api(`/routes?from_lat=${a.lat}&from_lng=${a.lng}&to_lat=${b.lat}&to_lng=${b.lng}`);
export const myPayouts = () => api('/drivers/payouts');
