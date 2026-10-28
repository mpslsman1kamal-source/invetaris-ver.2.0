/**
 * api.js — Lapisan komunikasi ke backend GAS REST API.
 * - fetch POST dengan header text/plain (hindari CORS preflight, wajib di gas-pro-api).
 * - Timeout + retry untuk aksi baca; aksi tulis dikirim dengan reqId agar aman di-retry (idempoten).
 * - Store: localStorage namespaced per-user untuk pola SWR (stale-while-revalidate) — Prinsip 2 gas-instant-ux-pro.
 */
(function () {
  const G = window.APP_CONFIG;
  const READ_ACTIONS = /^(bootstrap|dashboard|.*List$|.*Get$|laporan.*|antreanPersetujuan|pengaturanGet)$/;

  const Store = {
    get(k, d) { try { const v = localStorage.getItem(G.LS_PREFIX + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(G.LS_PREFIX + k, JSON.stringify(v)); } catch (e) { /* kuota penuh, abaikan */ } },
    del(k) { try { localStorage.removeItem(G.LS_PREFIX + k); } catch (e) {} },
    clearAll() {
      try {
        Object.keys(localStorage).filter(k => k.indexOf(G.LS_PREFIX) === 0).forEach(k => localStorage.removeItem(k));
      } catch (e) {}
    }
  };

  function getToken() { return Store.get('token', ''); }
  /** Decode payload token sesi HMAC (base64url, tanpa verifikasi tanda tangan — hanya untuk tampilan cepat; server tetap sumber kebenaran). */
  function decodeToken(token) {
    try {
      let b = String(token || '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(atob(b));
    } catch (e) { return null; }
  }
  function setToken(t) { Store.set('token', t); }
  function userKey(k) { return 'u:' + (getToken() ? 'session' : 'anon') + ':' + k; }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h + ':' + s.length; }

  async function apiOnce(action, data, timeoutMs, reqId) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(G.GAS_URL, {
        method: 'POST', redirect: 'follow', cache: 'no-store', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: getToken(), reqId, data: data || {} })
      });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch (e) { return { success: false, network: true, retryable: res.status >= 500 || res.status === 429, message: 'Server membalas HTTP ' + res.status + ' (bukan JSON). Pastikan GAS_URL di js/config.js benar dan Web App sudah di-deploy.' }; }
    } catch (err) {
      return { success: false, network: true, retryable: true, message: err.name === 'AbortError' ? 'Server terlalu lama merespons.' : 'Koneksi terputus.' };
    } finally { clearTimeout(timer); }
  }

  async function api(action, data, opt) {
    opt = opt || {};
    const isRead = READ_ACTIONS.test(action) || action === 'login';
    const reqId = isRead ? '' : (opt.reqId || (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()));
    const tries = isRead ? 3 : 2;
    let res;
    UI.loadingStart();
    for (let i = 0; i < tries; i++) {
      if (i) await new Promise(r => setTimeout(r, 1000 * i));
      res = await apiOnce(action, data, isRead ? (i ? 35000 : 20000) : 60000, reqId);
      if (res.success || !res.retryable) break;
    }
    UI.loadingDone();
    if (!res.success && res.code === 'AUTH') window.App && window.App.onSessionExpired && window.App.onSessionExpired();
    return res;
  }

  /** Pola stale-while-revalidate: render dari cache dulu (bila ada), lalu segarkan di latar. */
  async function swr(key, action, payload, render, opt) {
    opt = opt || {};
    const fresh = opt.fresh != null ? opt.fresh : 45000;
    const c = Store.get(userKey(key), null);
    if (c) render(c.data, true);
    if (c && !opt.force && Date.now() - c.t < fresh) return { success: true, data: c.data, cached: true };
    const res = await api(action, payload);
    if (res.success) {
      const h = hashStr(JSON.stringify(res.data));
      Store.set(userKey(key), { t: Date.now(), h, data: res.data });
      if (!c || c.h !== h) render(res.data, false);
    } else if (!c && opt.onError) { opt.onError(res); }
    return res;
  }

  window.API = { api, swr, Store, getToken, setToken, userKey };
})();
