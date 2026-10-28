/**
 * config.js — Konfigurasi frontend. ISI dua nilai di bawah setelah backend GAS di-deploy
 * dan OAuth Client ID dibuat (lihat PANDUAN-INSTALASI.md langkah Frontend).
 */
window.APP_CONFIG = {
  // URL Web App Apps Script hasil deploy (diakhiri /exec)
  GAS_URL: 'https://script.google.com/macros/s/AKfycbx6eC3ZStQbl9EGls0iKXMmJPUb774Q5KGllGPshdhEd60_LX3IWO5lbMsMjTBZAjpIGQ/exec',

  // OAuth 2.0 Web Client ID dari Google Cloud Console (dipakai Google Identity Services di login)
  GOOGLE_CLIENT_ID: '205753482502-u4grm39n2lh3bbrv3idt3hftraf6taju.apps.googleusercontent.com',

  APP_NAME: 'Inventaris Barang SMAN 1 Kamal Bangkalan',
  LS_PREFIX: 'invbrg:v1:'
};
