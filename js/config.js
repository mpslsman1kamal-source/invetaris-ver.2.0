/**
 * config.js — Konfigurasi frontend. ISI dua nilai di bawah setelah backend GAS di-deploy
 * dan OAuth Client ID dibuat (lihat PANDUAN-INSTALASI.md langkah Frontend).
 */
window.APP_CONFIG = {
  // URL Web App Apps Script hasil deploy (diakhiri /exec)
  GAS_URL: 'https://script.google.com/macros/s/AKfycbx6eC3ZStQbl9EGls0iKXMmJPUb774Q5KGllGPshdhEd60_LX3IWO5lbMsMjTBZAjpIGQ/exec',

  // OAuth 2.0 Web Client ID dari Google Cloud Console (dipakai Google Identity Services di login)
  GOOGLE_CLIENT_ID: '158192917562-7e9e8tcvvcacpf25741jm0vu8he9o0p6.apps.googleusercontent.com',  
  APP_NAME: 'Inventaris Barang  ver. 2— Web',
  LS_PREFIX: 'invbrg:v1:'
};
