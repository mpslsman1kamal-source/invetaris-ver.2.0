/**
 * app.js — Bootstrap aplikasi: autentikasi Google Identity Services, router SPA hash-based
 * (Client-Side SPA — Prinsip 1 gas-instant-ux-pro: halaman dibuat sekali, disembunyikan/
 * ditampilkan, bukan dibongkar-pasang), navigasi role-aware, dan sesi.
 */
(function () {
  const el = UI.el;
  const App = { state: { token: '', user: null, perms: {}, pengaturan: {} }, pageCache: {} };
  window.App = App;

  // ---------------- AUTH ----------------
  function showLoginError_(text, err) {
    const msg = document.getElementById('login-msg');
    msg.textContent = text;
    msg.className = 'login-msg show'; msg.style.color = '#991B1B';
    if (err) console.error('[Inventaris] ' + text, err); else console.error('[Inventaris] ' + text);
  }

  /** Deteksi dini: config.js belum diisi (penyebab #1 login kosong tanpa pesan apapun). */
  function configBelumDiisi_() {
    const cid = APP_CONFIG.GOOGLE_CLIENT_ID || '';
    const url = APP_CONFIG.GAS_URL || '';
    if (!cid || cid.indexOf('GANTI_DENGAN') > -1) {
      return 'GOOGLE_CLIENT_ID di js/config.js belum diisi dengan Client ID asli dari Google Cloud Console (lihat PANDUAN-INSTALASI.md Bagian A4 & B).';
    }
    if (!url || url.indexOf('GANTI_DENGAN') > -1) {
      return 'GAS_URL di js/config.js belum diisi dengan URL Web App (diakhiri /exec) hasil deploy backend (lihat PANDUAN-INSTALASI.md Bagian A6 & B).';
    }
    return null;
  }

  /**
   * Siapkan tombol login Google. Dipanggil berulang (poll) karena tag <script> GSI memakai
   * async+defer sekaligus — urutan muatnya TIDAK terjamin selesai sebelum app.js jalan, jadi
   * window.google bisa saja belum ada padahal skripnya akan selesai dimuat sesaat lagi.
   * Semua kegagalan WAJIB tampil sebagai pesan — sebelumnya initialize()/renderButton() yang
   * melempar error (mis. client_id tidak valid) membuat layar login kosong tanpa petunjuk sama sekali.
   */
  function initLogin(attempt) {
    attempt = attempt || 0;
    const masalahConfig = configBelumDiisi_();
    if (masalahConfig) { showLoginError_(masalahConfig); return; }

    if (!window.google || !google.accounts || !google.accounts.id) {
      if (attempt < 20) { setTimeout(() => initLogin(attempt + 1), 250); return; }
      showLoginError_('Gagal memuat Google Identity Services (accounts.google.com/gsi/client) setelah menunggu 5 detik. Periksa koneksi internet, nonaktifkan pemblokir iklan/skrip untuk situs ini, lalu muat ulang halaman.');
      return;
    }

    try {
      google.accounts.id.initialize({
        client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
        callback: onGoogleCredential,
        auto_select: false
      });
      const container = document.getElementById('gsi-button-container');
      google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280 });

      // GSI menolak origin yang tidak terdaftar dengan GAGAL DIAM-DIAM (tidak melempar error JS
      // yang bisa ditangkap try/catch di atas — hanya mencatat "[GSI_LOGGER] ... not allowed for
      // the given client ID" ke console). Satu-satunya cara mendeteksinya dari sini: cek apakah
      // kontainer tombol benar-benar terisi beberapa saat setelah renderButton() dipanggil.
      setTimeout(() => {
        if (!container.hasChildNodes()) {
          showLoginError_('Tombol login Google tidak muncul. Penyebab paling umum: domain "' + location.origin + '" belum ditambahkan ke "Authorized JavaScript origins" pada OAuth Client ID di Google Cloud Console (Credentials → Client ID ini → edit). Buka Console browser (F12 → tab Console) untuk pesan [GSI_LOGGER] yang memastikan ini, lalu lihat PANDUAN-INSTALASI.md Bagian A4.');
        }
      }, 1500);
    } catch (err) {
      showLoginError_('Gagal menyiapkan tombol login Google: ' + (err && err.message ? err.message : err) + '. Kemungkinan GOOGLE_CLIENT_ID salah format, atau domain situs ini belum ditambahkan ke "Authorized JavaScript origins" pada Google Cloud Console (lihat PANDUAN-INSTALASI.md Bagian A4).', err);
    }
  }

  async function onGoogleCredential(response) {
    const msg = document.getElementById('login-msg');
    msg.className = 'login-msg show'; msg.style.color = '#1B1B1B'; msg.textContent = 'Memeriksa akun...';
    try {
      const res = await API.api('login', { idToken: response.credential });
      if (!res.success) {
        msg.style.color = '#991B1B';
        msg.textContent = res.message || 'Login gagal.';
        return;
      }
      API.setToken(res.data.token);
      API.Store.set(API.userKey('boot'), { t: Date.now(), data: res.data.boot });
      applyBoot(res.data.user, res.data.boot);
      enterApp();
    } catch (err) {
      // Jangan biarkan layar macet diam-diam di "Memeriksa akun..." — tampilkan errornya.
      msg.style.color = '#991B1B';
      msg.textContent = 'Terjadi kesalahan saat memproses login: ' + (err && err.message ? err.message : err);
      console.error('[Inventaris] onGoogleCredential gagal', err);
    }
  }

  function applyBoot(user, boot) {
    App.state.user = user;
    App.state.perms = boot.perms;
    App.state.pengaturan = boot.pengaturan || {};
    App.state.lastDashboard = boot.dashboard;
  }

  function onSessionExpired() {
    API.setToken('');
    API.Store.clearAll();
    document.getElementById('app-shell').classList.remove('show');
    document.getElementById('login-screen').style.display = 'flex';
    UI.toast('Sesi berakhir, silakan login kembali.', 'error');
  }
  App.onSessionExpired = onSessionExpired;

  function logout() {
    const email = App.state.user && App.state.user.email;
    API.api('logout', {});
    API.setToken('');
    API.Store.clearAll();
    location.hash = '';
    document.getElementById('app-shell').classList.remove('show');
    document.getElementById('login-screen').style.display = 'flex';

    // Bangun ulang tombol login agar tidak lagi menampilkan chip akun lama. PENTING: ini
    // HANYA dipanggil setelah revoke() selesai (lewat callback-nya), bukan langsung sesudah
    // memanggilnya — membongkar/membuat ulang elemen tombol SAAT revoke() masih berjalan
    // (keduanya sama-sama memakai iframe/postMessage milik GSI) menyebabkan GSI gagal
    // menyelesaikan proses internalnya ("Failed to send postmessage to iframe", tombol jadi
    // rusak dan login berikutnya macet di "Memeriksa akun...").
    let dibangunUlang = false;
    function rebuildLoginButton() {
      if (dibangunUlang) return; // jaga-jaga agar tidak dibangun dua kali (callback + fallback timeout)
      dibangunUlang = true;
      const container = document.getElementById('gsi-button-container');
      const msg = document.getElementById('login-msg');
      if (msg) { msg.className = 'login-msg'; msg.textContent = ''; }
      if (container) container.innerHTML = '';
      initLogin();
    }
    try {
      if (window.google && google.accounts && google.accounts.id) {
        // disableAutoSelect() mencegah one-tap otomatis memilih akun ini lagi.
        google.accounts.id.disableAutoSelect();
        // revoke() melepas izin akun ini dari aplikasi di sisi Google agar tombol login
        // kembali bersih (tanpa chip) — baru setelah ini selesai, tombol dibangun ulang.
        if (email) {
          google.accounts.id.revoke(email, () => rebuildLoginButton());
          setTimeout(rebuildLoginButton, 2000); // jaring pengaman bila callback revoke() tak pernah terpanggil
        } else {
          rebuildLoginButton();
        }
      } else {
        rebuildLoginButton();
      }
    } catch (e) {
      console.error('[Inventaris] Gagal membersihkan sesi Google Identity Services', e);
      rebuildLoginButton();
    }
  }

  // ---------------- SHELL / NAV ----------------
  function enterApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').classList.add('show');
    document.getElementById('whoName').textContent = App.state.user.nama;
    document.getElementById('whoRole').textContent = roleLabel(App.state.user.role);
    document.getElementById('whoAvatar').textContent = (App.state.user.nama || '?').charAt(0).toUpperCase();
    document.getElementById('rolePillText').textContent = roleLabel(App.state.user.role);
    buildNav();
    route();
  }

  function roleLabel(r) { return ({ SUPER_ADMIN: 'Super Admin', STAF_INVENTARIS: 'Staf Inventaris', BENDAHARA: 'Bendahara', KEPALA_SEKOLAH: 'Kepala Sekolah' })[r] || r; }

  function buildNav() {
    const nav = document.getElementById('navMenu');
    nav.innerHTML = '';
    PAGES.forEach(p => {
      if (!PAGES_CAN(p.modul, 'R') && !(p.altModul && PAGES_CAN(p.altModul, 'R'))) return;
      const a = el('a', { href: '#/' + p.id, 'data-page': p.id }, [el('span', {}, [p.label])]);
      nav.appendChild(a);
    });
    updateBadges();
  }

  async function updateBadges() {
    if (!PAGES_CAN('permintaan', 'A') && !PAGES_CAN('peminjaman', 'A') && !PAGES_CAN('mutasi', 'A') && !PAGES_CAN('penghapusan', 'A')) return;
    const res = await API.api('dashboard', {});
    if (!res.success) return;
    const a = document.querySelector('a[data-page="permintaan"]');
    if (a && res.data.totalAntrean > 0) {
      const badge = el('span', { class: 'badge-count' }, [String(res.data.totalAntrean)]);
      a.appendChild(badge);
    }
  }

  // ---------------- ROUTER ----------------
  function route() {
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const pageId = hash.split('/')[0];
    const def = PAGES.find(p => p.id === pageId) || PAGES[0];

    document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.page === def.id));
    document.getElementById('crumbPage').textContent = def.label;

    document.querySelectorAll('main.content .page').forEach(s => s.classList.remove('active'));
    let container = App.pageCache[def.id];
    if (!container) {
      container = el('section', { class: 'page', 'data-page': def.id });
      document.getElementById('pageMount').appendChild(container);
      App.pageCache[def.id] = container;
      def.render(container); // render sekali, elemen DOM dipertahankan untuk kunjungan berikutnya
    }
    container.classList.add('active');
  }

  window.addEventListener('hashchange', route);

  // ---------------- INIT ----------------
  document.getElementById('modalClose').addEventListener('click', UI.closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') UI.closeModal(); });
  document.getElementById('btnLogout').addEventListener('click', logout);

  function warmUp() { fetch(APP_CONFIG.GAS_URL + '?ping=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); }

  async function boot() {
    warmUp();
    const token = API.getToken();
    if (!token) { initLogin(); return; }
    // Sesi tersimpan: coba lanjutkan tanpa login ulang (bootstrap aksi membaca token).
    const cachedBoot = API.Store.get(API.userKey('boot'), null);
    if (cachedBoot) {
      // Render instan dari cache lokal dulu (SWR), lalu validasi ke server di latar belakang.
      try {
        const tokenInfo = JSON.parse(atob(token.split('.')[0]));
        applyBoot({ email: tokenInfo.email, role: tokenInfo.role, nama: tokenInfo.nama, idUser: tokenInfo.idUser }, cachedBoot.data);
        enterApp();
      } catch (e) { /* lanjut ke validasi server */ }
    }
    const res = await API.api('bootstrap', {});
    if (!res.success) { onSessionExpired(); initLogin(); return; }
    applyBoot(res.data.user, res.data);
    API.Store.set(API.userKey('boot'), { t: Date.now(), data: res.data });
    if (!cachedBoot) enterApp(); else { buildNav(); if (App.pageCache.dashboard) { App.pageCache.dashboard.innerHTML = ''; PAGES[0].render(App.pageCache.dashboard); } }
  }

  boot();
})();
