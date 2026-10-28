# Inventaris Barang — SMAN 1 Kamal Bangkalan

Frontend aplikasi web Inventaris Barang (GAS-PRO-API architecture): HTML/CSS/JS murni, SPA client-side, berkomunikasi dengan backend Google Apps Script lewat `fetch()`/REST JSON.

**Sebelum di-deploy**, baca `PANDUAN-INSTALASI.md` di folder ini — backend (Google Apps Script) harus disiapkan dulu, lalu `js/config.js` diisi URL backend & Google Client ID, baru folder ini di-deploy ke GitHub Pages (atau hosting statis lain).

## Struktur

```
index.html          Shell aplikasi (login + app shell)
css/style.css        Seluruh styling, token desain "Institutional Ledger Blueprint"
js/config.js          Konfigurasi (GAS_URL, GOOGLE_CLIENT_ID) — ISI DULU sebelum deploy
js/api.js             Lapisan komunikasi REST + penyimpanan token + LocalStorage cache
js/ui.js               Komponen UI dasar (modal, toast, tabel, badge, dsb)
js/pages.js            16 halaman aplikasi (dashboard, aset, persediaan, transaksi, dst.)
js/app.js              Bootstrap, login Google Identity Services, router SPA
js/vendor/qrcode.min.js  Pustaka pembuat QR Code (client-side, untuk label aset)
PANDUAN-INSTALASI.md   Panduan lengkap setup backend + deploy frontend
```

## Arsitektur singkat

- **Autentikasi**: Google Identity Services (GSI) di klien → ID Token dikirim ke backend → backend verifikasi ke endpoint resmi Google, cocokkan ke sheet `USERS`, terbitkan token sesi HMAC. RBAC divalidasi ulang di server pada setiap aksi.
- **Performa**: Client-side SPA (navigasi tanpa reload), optimistic UI + LocalStorage, `CacheService` di backend, dan batch read/write ke Google Sheets (prinsip gas-instant-ux-pro).
- **Database**: 19 sheet Google Sheets sesuai PRD, dibuat otomatis oleh `Setup.gs` di backend.
- **Cetak dokumen**: KIB, KIR, Buku Inventaris, Mutasi, Penyusutan, Berita Acara, dan Label QR dihasilkan sebagai PDF dari template Google Docs (lihat `PANDUAN-INSTALASI.md` Bagian A7).
