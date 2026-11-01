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
    throw new ApiError(0, 'No connection. Check your network and try again.');
  } finally { clearTimeout(timer); }
}
let refreshing = null;
async function refreshTokens() {
  const r = await raw('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } });
  await saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
}
export async function api(path, opts) {
  try { return await raw(path, opts); } catch (e) {
    if (e.status === 401 && tokens && tokens.refreshToken) {
      try { refreshing = refreshing || refreshTokens(); await refreshing; } catch (err) { await saveTokens(null); onLogout(); throw e; } finally { refreshing = null; }
      return raw(path, opts);
    }
    throw e;
  }
}
const post = (path, body) => api(path, { method: 'POST', body });

// auth
export const otpSend = (phone) => post('/auth/otp/send', { phone });
export const register = (phone, name, language) => post('/auth/register', { phone, name, ...(language ? { language } : {}) });
export const otpVerify = (phone, code) => post('/auth/otp/verify', { phone, code });
// account
export const getMe = () => api('/users/me');
export const updateMe = (body) => api('/users/me', { method: 'PATCH', body });
export const clearPushToken = () => api('/users/me/push-token', { method: 'DELETE' });
export const myBookings = () => api('/users/me/bookings?limit=30');
export const getWallet = () => api('/users/me/wallet');
// rides
export const estimate = (b) => post('/bookings/estimate', b);
export const createBooking = (b) => post('/bookings', b);
export const getBooking = (id) => api(`/bookings/${id}`);
export const cancelBooking = (id) => post(`/bookings/${id}/cancel`);
export const rateBooking = (id, stars, comment) => post(`/bookings/${id}/rate`, { stars, ...(comment ? { comment } : {}) });
// tours, parcels, subscriptions
export const getTours = () => api('/tours');
export const bookTour = (id, b) => post(`/tours/${id}/book`, b);
export const createParcel = (b) => post('/parcels', b);
export const myParcels = () => api('/parcels');
export const trackParcel = (tid) => api(`/parcels/${tid}`);
export const getPlans = () => api('/subscriptions/plans');
export const mySubs = () => api('/subscriptions/me');
export const createSub = (b) => post('/subscriptions', b);
export const cancelSub = (id) => post(`/subscriptions/${id}/cancel`);
// payments
export const receipt = (id) => api(`/payments/${id}/receipt`).then((r) => r.receipt);
export function pay({ purpose, targetId, method, phone, amount }) {
  const ph = phone ? { phone } : {};
  if (purpose === 'BOOKING') return post(`/bookings/${targetId}/pay`, { method, ...ph });
  if (purpose === 'PARCEL') return post('/payments/mpesa/stkpush', { parcel_id: targetId, method, ...ph });
  if (purpose === 'INVOICE') return post('/payments/mpesa/stkpush', { invoice_id: targetId, method, ...ph });
  return post('/users/me/wallet/topup', { amount, method, ...ph });
}

export const errorText = (e) => {
  const d = e.details ? ' ' + Object.entries(e.details).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join('; ') + '.' : '';
  return (e.message || 'Something went wrong') + (e.message === 'Invalid input' ? d : '');
};

export const getRoute = (a, b) => api(`/routes?from_lat=${a.lat}&from_lng=${a.lng}&to_lat=${b.lat}&to_lng=${b.lng}`);
export const getMethods = () => api('/payments/methods');
