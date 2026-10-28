/**
 * pages.js — Definisi seluruh halaman SPA (16 layar PRD, diadaptasi dari referensi desain
 * Stitch) + logika binding ke REST API. Setiap halaman = {id,label,modul,group,render(mount)}.
 * Dipakai oleh js/app.js (router hash-based, Client-Side SPA — Prinsip 1 gas-instant-ux-pro).
 */
(function () {
  const api = (a, d) => API.api(a, d);
  const el = UI.el;
  // Baca daftar (list) dengan pola stale-while-revalidate (API.swr, sudah ada di api.js):
  // tampilkan dari cache lokal dulu bila masih segar, baru panggil server bila perlu.
  // Mengurangi jeda setiap buka menu/pindah tab/buka form tambah data, tanpa mengubah
  // bentuk respons ({success, data}) yang dipakai kode di bawah.
  const apiList = (action, payload, opt) => { opt = opt || {}; return API.swr('list:' + action, action, payload || {}, () => {}, { fresh: opt.fresh || 30000, force: !!opt.force }); };

  function can(modul, aksi) {
    const perms = App.state.perms || {};
    const role = App.state.user ? App.state.user.role : '';
    const p = perms[modul]; if (!p) return false;
    return (p[role] || '').indexOf(aksi) > -1;
  }
  function guardModul(mount, modul) {
    if (!can(modul, 'R')) { mount.appendChild(el('div', { class: 'card' }, ['Anda tidak memiliki akses ke modul ini.'])); return false; }
    return true;
  }
  function pageHead(mount, title, desc, toolbarNode) {
    const head = el('div', { class: 'page-head' }, [
      el('div', {}, [el('h1', {}, [title]), desc ? el('div', { class: 'desc' }, [desc]) : null]),
      toolbarNode || null
    ]);
    mount.appendChild(head);
    return head;
  }
  function tabsBar(mount, tabs, activeId, onChange) {
    const bar = el('div', { class: 'tabs' }, tabs.map(t =>
      el('button', { class: 'tab-btn' + (t.id === activeId ? ' active' : ''), type: 'button', onclick: () => onChange(t.id) }, [t.label])
    ));
    mount.appendChild(bar);
    return bar;
  }
  async function refreshBody(mount, renderFn) {
    const body = el('div', {});
    mount.appendChild(body);
    await renderFn(body);
    return body;
  }
  function section(mount) { const s = el('div', {}); mount.appendChild(s); return s; }

  // ------------------------------------------------------------------
  // Pratinjau sebelum cetak PDF — ditampilkan lewat modal sebelum dokumen benar-benar
  // dibuat/diunduh, supaya isi (kop, filter yang aktif, dan daftar datanya) bisa dicek dulu.
  // opts: { judul, infoLines:[string], columns, rows, onCetak: async () => void }
  // ------------------------------------------------------------------
  function previewCetak(opts) {
    // Dibungkus try/catch: opts.rows/columns/extraNode berasal dari banyak pemanggil (7 jenis
    // cetak, semua role). Bila salah satu pemanggil melempar error tak terduga (mis. data
    // referensi belum siap), tombol "Cetak PDF" sebelumnya terlihat tidak bereaksi sama sekali
    // (error hanya tercatat diam-diam di console) — sekarang selalu ada notifikasi terlihat,
    // apa pun role yang memakainya.
    try {
      const p = App.state.pengaturan || {};
      const wrap = el('div', {});
      wrap.appendChild(el('div', { class: 'card', style: 'text-align:center;margin-bottom:12px' }, [
        el('div', { style: 'font-weight:700' }, [p.nama_instansi || 'SMAN 1 Kamal Bangkalan']),
        p.alamat ? el('div', { class: 'muted', style: 'font-size:12px' }, [p.alamat]) : null,
        el('div', { class: 'muted', style: 'font-size:12px' }, ['Kepala Sekolah: ' + (p.kepala_sekolah || '-') + ' · Tahun Ajaran: ' + (p.tahun_ajaran || '-')])
      ]));
      wrap.appendChild(el('h3', { style: 'margin:0 0 4px' }, [opts.judul]));
      if (opts.infoLines && opts.infoLines.length) {
        wrap.appendChild(el('div', { class: 'desc mb-8' }, [opts.infoLines.join(' · ')]));
      }
      if (opts.extraNode) wrap.appendChild(opts.extraNode);
      if (opts.rows) {
        if (!opts.rows.length) {
          wrap.appendChild(el('div', { class: 'card mt-8' }, ['Tidak ada data untuk dicetak dengan filter saat ini.']));
        } else {
          const tableHolder = el('div', { style: 'max-height:360px;overflow:auto;border:1px solid var(--border,#e2e2e2)' });
          wrap.appendChild(tableHolder);
          UI.dataTable(tableHolder, opts.columns, opts.rows);
        }
      }
      const footBtn = el('div', { class: 'flex gap-8' }, [
        el('button', { class: 'btn btn-secondary', onclick: UI.closeModal }, ['Batal']),
        el('button', {
          class: 'btn btn-primary', onclick: async (e) => {
            e.target.disabled = true; e.target.textContent = 'Membuat PDF...';
            try { await opts.onCetak(); } catch (err) { UI.toast('Gagal membuat PDF: ' + (err && err.message ? err.message : err), 'error'); } finally { UI.closeModal(); }
          }
        }, ['Cetak PDF Sekarang'])
      ]);
      UI.openModal('Pratinjau Cetak — ' + opts.judul, wrap, footBtn);
    } catch (err) {
      UI.toast('Gagal membuka pratinjau cetak: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  // ------------------------------------------------------------------
  // Factory CRUD generik untuk master data sederhana (kode unik, toggle aktif)
  // ------------------------------------------------------------------
  function crudSimple(opts) {
    // opts: {listAction, saveAction, toggleAction, modul, idKey, columns, fields, title}
    return async function (mount) {
      if (!guardModul(mount, opts.modul)) return;
      const toolbar = can(opts.modul, 'C') ? el('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, ['+ Tambah']) : null;
      pageHead(mount, opts.title, opts.desc || '', toolbar);
      const tableMount = section(mount);
      let rows = [];
      // Pola stale-while-revalidate (API.swr, sudah ada di api.js): render instan dari cache
      // lokal pada kunjungan berikutnya, lalu segarkan di latar — mengurangi jeda saat pindah
      // menu, tanpa mengubah struktur/alur halaman.
      async function load(force) {
        return API.swr('list:' + opts.listAction, opts.listAction, {}, (data) => { rows = data || []; draw(); }, { force: !!force, fresh: 30000 });
      }
      function draw() {
        tableMount.innerHTML = '';
        UI.dataTable(tableMount, opts.columns, rows, {
          actions: (row) => el('div', { class: 'flex gap-8' }, [
            can(opts.modul, 'U') ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openForm(row) }, ['Ubah']) : null,
            can(opts.modul, 'D') ? el('button', { class: 'btn btn-destructive btn-sm', onclick: () => toggleRow(row) }, [row.aktif === 'Nonaktif' || row.status_aktif === 'Nonaktif' ? 'Aktifkan' : 'Nonaktifkan']) : null
          ])
        });
      }
      async function toggleRow(row) {
        if (!UI.confirmDialog('Ubah status data ini?')) return;
        const res = await api(opts.toggleAction, { [opts.idKey]: row[opts.idKey] });
        UI.toast(res.message, res.success ? 'success' : 'error');
        if (res.success) load(true);
      }
      function openForm(row) {
        const isNew = !row;
        const form = UI.buildForm(opts.fields, row || {});
        const footBtn = el('button', {
          class: 'btn btn-primary', onclick: async () => {
            const vals = form.getValues();
            if (!isNew) vals[opts.idKey] = row[opts.idKey];
            vals.isNew = isNew;
            const res = await api(opts.saveAction, vals);
            UI.toast(res.message, res.success ? 'success' : 'error');
            if (res.success) { UI.closeModal(); load(true); }
          }
        }, ['Simpan']);
        UI.openModal((isNew ? 'Tambah ' : 'Ubah ') + opts.title, form.node, footBtn);
      }
      load();
    };
  }

  // ------------------------------------------------------------------
  // 1) DASHBOARD (US-01)
  // ------------------------------------------------------------------
  async function renderDashboard(mount) {
    pageHead(mount, 'Dashboard', 'Ringkasan kondisi inventaris — ' + (App.state.pengaturan.tahun_ajaran || ''));
    const body = section(mount);
    // Data dashboard sudah ikut dikirim backend saat login (bootstrapData_ di Modules_Dashboard.gs).
    // Pakai itu untuk tampilan instan (hindari jeda round-trip tambahan setelah login), lalu
    // segarkan di latar belakang agar tetap akurat bila data berubah di sheet.
    let d = App.state.lastDashboard;
    if (d) {
      drawDashboard(body, d);
      api('dashboard', {}).then(res => { if (res.success) { App.state.lastDashboard = res.data; drawDashboard(body, res.data); } });
      return;
    }
    body.innerHTML = '<div class="kpi-grid">' + Array(4).fill('<div class="card"><div class="skeleton" style="width:60%"></div><div class="skeleton mt-16" style="width:40%;height:24px"></div></div>').join('') + '</div>';
    const res = await api('dashboard', {});
    if (!res.success) { body.innerHTML = ''; body.appendChild(el('div', { class: 'card' }, [res.message])); return; }
    App.state.lastDashboard = res.data;
    drawDashboard(body, res.data);
  }

  function drawDashboard(body, d) {
    body.innerHTML = '';
    const kpi = el('div', { class: 'kpi-grid' }, [
      el('div', { class: 'kpi', style: '--accent-strip:var(--accent)' }, [el('div', { class: 'lbl' }, ['Total Nilai Aset']), el('div', { class: 'val' }, [UI.rupiah(d.totalNilaiAset)]), el('div', { class: 'sub' }, [d.jumlahAset + ' unit aset aktif'])]),
      el('div', { class: 'kpi', style: '--accent-strip:#166534' }, [el('div', { class: 'lbl' }, ['Masuk Bulan Ini']), el('div', { class: 'val' }, [String(d.masukBulanIni)]), el('div', { class: 'sub' }, ['transaksi barang masuk'])]),
      el('div', { class: 'kpi', style: '--accent-strip:#92400E' }, [el('div', { class: 'lbl' }, ['Stok di Bawah Minimum']), el('div', { class: 'val' }, [String(d.stokMinimCount)]), el('div', { class: 'sub' }, ['barang persediaan'])]),
      el('div', { class: 'kpi', style: '--accent-strip:#991B1B' }, [el('div', { class: 'lbl' }, ['Antrean Persetujuan']), el('div', { class: 'val' }, [String(d.totalAntrean)]), el('div', { class: 'sub' }, ['menunggu Kepala Sekolah'])])
    ]);
    body.appendChild(kpi);

    const grid = el('div', { class: 'grid-2' });
    const kondisiCard = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0' }, ['Kondisi Barang']),
      el('div', { class: 'flex gap-8 wrap mt-8' }, [
        UI.badge('Baik'), el('span', {}, [' ' + d.kondisi.Baik + '  ']),
        UI.badge('Rusak Ringan'), el('span', {}, [' ' + d.kondisi['Rusak Ringan'] + '  ']),
        UI.badge('Rusak Berat'), el('span', {}, [' ' + d.kondisi['Rusak Berat']])
      ])
    ]);
    const peringatan = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0' }, ['Peringatan']),
      el('ul', { style: 'margin:0;padding-left:18px;font-size:12.5px;line-height:1.9' }, [
        el('li', {}, ['Permintaan menunggu: ' + d.antrean.permintaan]),
        el('li', {}, ['Mutasi menunggu: ' + d.antrean.mutasi]),
        el('li', {}, ['Peminjaman menunggu: ' + d.antrean.peminjaman]),
        el('li', {}, ['Penghapusan menunggu: ' + d.antrean.penghapusan]),
        el('li', {}, ['Tiket kerusakan aktif: ' + d.tiketAktif]),
        el('li', {}, ['Jadwal servis ≤30 hari: ' + d.servisJatuhTempo])
      ])
    ]);
    grid.appendChild(kondisiCard); grid.appendChild(peringatan);
    body.appendChild(grid);

    if (d.keuangan) {
      body.appendChild(el('div', { class: 'card mt-16' }, [
        el('h3', { style: 'margin-top:0' }, ['Ringkasan Keuangan']),
        el('div', {}, ['Dokumen belum diverifikasi: ' + d.keuangan.belumVerifikasi + ' · Tidak sesuai: ' + d.keuangan.tidakSesuai])
      ]));
    }
  }

  // ------------------------------------------------------------------
  // 2) ASET TETAP (KIB) + PERSEDIAAN + LABEL QR
  // ------------------------------------------------------------------
  const RUANGAN_CACHE = { data: [] };
  async function loadRefData() {
    const [kat, rng, ped] = await Promise.all([apiList('kategoriList', {}), apiList('ruanganList', {}), apiList('pegawaiList', {})]);
    return { kategori: kat.success ? kat.data : [], ruangan: rng.success ? rng.data : [], pegawai: ped.success ? ped.data : [] };
  }

  async function renderAset(mount) {
    if (!guardModul(mount, 'aset')) return;
    let tab = 'tetap';
    pageHead(mount, 'Aset (KIB A–F, Persediaan, QR)', 'Manajemen aset tetap & barang habis pakai');
    const tabsMount = section(mount), bodyMount = section(mount);
    draw();
    function draw() {
      tabsMount.innerHTML = '';
      tabsBar(tabsMount, [{ id: 'tetap', label: 'Aset Tetap (KIB)' }, { id: 'persediaan', label: 'Persediaan' }, { id: 'qr', label: 'Label QR' }], tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      if (tab === 'tetap') renderAsetTetap(bodyMount);
      else if (tab === 'persediaan') renderPersediaan(bodyMount);
      else renderLabelQr(bodyMount);
    }
  }

  async function renderAsetTetap(mount) {
    const ref = await loadRefData();
    const ruanganMap = {}; ref.ruangan.forEach(r => ruanganMap[r.id_ruangan] = r.nama_ruangan);
    const kategoriOpts = ref.kategori.filter(k => k.jenis === 'Aset Tetap').map(k => ({ value: k.kode_barang, label: k.kode_barang + ' — ' + k.nama_kategori }));
    const ruanganOpts = ref.ruangan.map(r => ({ value: r.id_ruangan, label: r.nama_ruangan }));
    const toolbar = can('aset', 'C') ? el('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, ['+ Tambah Aset']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    let rows = [];
    async function load(force) { const res = await apiList('asetList', {}, { force }); rows = res.success ? res.data : []; draw(); }
    function draw() {
      tableMount.innerHTML = '';
      UI.dataTable(tableMount, [
        { key: 'id_aset', label: 'Kode Aset', type: 'code' },
        { key: 'nama', label: 'Nama' },
        { key: 'kode_barang', label: 'Kategori' },
        { key: 'id_ruangan', label: 'Ruangan', render: r => ruanganMap[r.id_ruangan] || r.id_ruangan },
        { key: 'tahun_perolehan', label: 'Tahun' },
        { key: 'nilai_perolehan', label: 'Nilai Perolehan', type: 'rupiah' },
        { key: 'kondisi', label: 'Kondisi', type: 'badge' },
        { key: 'status', label: 'Status', type: 'badge' }
      ], rows, {
        actions: (row) => el('div', { class: 'flex gap-8' }, [
          can('aset', 'U') ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openForm(row) }, ['Ubah']) : null
        ])
      });
    }
    function openForm(row) {
      const isNew = !row;
      const fields = [
        { key: 'kode_barang', label: 'Kategori / Kode Barang', type: 'select', options: kategoriOpts, required: true },
        { key: 'nama', label: 'Nama Aset', required: true },
        { key: 'merek_tipe', label: 'Merek / Tipe' },
        { key: 'nomor_identitas', label: 'No. Rangka/Mesin/Sertifikat' },
        { key: 'tahun_perolehan', label: 'Tahun Perolehan', type: 'number', required: true },
        { key: 'nilai_perolehan', label: 'Nilai Perolehan (Rp)', type: 'number', required: true },
        { key: 'sumber_dana', label: 'Sumber Dana' },
        { key: 'kondisi', label: 'Kondisi', type: 'select', options: [{ value: 'Baik', label: 'Baik' }, { value: 'Rusak Ringan', label: 'Rusak Ringan' }, { value: 'Rusak Berat', label: 'Rusak Berat' }], required: true },
        { key: 'id_ruangan', label: 'Ruangan', type: 'select', options: ruanganOpts, required: true, span2: true },
        { key: 'foto', label: 'Foto Aset', type: 'file', span2: true }
      ];
      const simpleFields = fields.filter(f => f.type !== 'file');
      const form = UI.buildForm(simpleFields, row || {});
      const fileWrap = el('div', { class: 'field span-2' }, [el('label', {}, ['Foto Aset']), el('input', { type: 'file', accept: 'image/*', id: 'fotoInput' }), el('div', { class: 'hint' }, ['Foto akan dikompres otomatis sebelum diunggah.'])]);
      form.node.appendChild(fileWrap);
      const footBtn = el('button', {
        class: 'btn btn-primary', onclick: async () => {
          const vals = form.getValues();
          if (!isNew) vals.id_aset = row.id_aset;
          const fotoInput = document.getElementById('fotoInput');
          if (fotoInput && fotoInput.files && fotoInput.files[0]) {
            const compressed = await compressImage(fotoInput.files[0]);
            const up = await api('asetUploadFoto', { base64: compressed, namaFile: fotoInput.files[0].name, mimeType: 'image/jpeg', id_aset: row ? row.id_aset : '' });
            if (up.success) vals.url_foto = up.data.url;
          }
          const res = await api('asetSave', vals);
          UI.toast(res.message, res.success ? 'success' : 'error');
          if (res.success) { UI.closeModal(); load(true); }
        }
      }, ['Simpan']);
      UI.openModal((isNew ? 'Tambah' : 'Ubah') + ' Aset Tetap', form.node, footBtn);
    }
    load();
  }

  /** Kompresi gambar di klien (PRD §6.2.5) sebelum diunggah sebagai base64 JPEG. */
  function compressImage(file, maxW) {
    maxW = maxW || 1000;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxW / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = img.width * scale; canvas.height = img.height * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function renderPersediaan(mount) {
    const toolbar = el('div', { class: 'flex gap-8' }, [
      can('persediaan', 'C') ? el('button', { class: 'btn btn-secondary', onclick: () => openStok('masuk') }, ['Barang Masuk']) : null,
      can('persediaan', 'U') ? el('button', { class: 'btn btn-secondary', onclick: () => openStok('keluar') }, ['Barang Keluar']) : null,
      can('stock_opname', 'U') ? el('button', { class: 'btn btn-secondary', onclick: () => openOpname() }, ['Stock Opname']) : null,
      can('persediaan', 'C') ? el('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, ['+ Barang Baru']) : null
    ]);
    mount.appendChild(toolbar);
    const tableMount = section(mount);
    let rows = [];
    async function load(force) { const res = await apiList('persediaanList', {}, { force }); rows = res.success ? res.data : []; draw(); }
    function draw() {
      tableMount.innerHTML = '';
      UI.dataTable(tableMount, [
        { key: 'id_barang', label: 'Kode', type: 'code' }, { key: 'nama', label: 'Nama Barang' }, { key: 'satuan', label: 'Satuan' },
        { key: 'stok_saat_ini', label: 'Stok', type: 'num', render: r => el('span', { style: Number(r.stok_saat_ini) <= Number(r.stok_minimum) ? 'color:var(--crit-text);font-weight:700' : '' }, [String(r.stok_saat_ini)]) },
        { key: 'stok_minimum', label: 'Stok Minimum', type: 'num' }
      ], rows, { actions: (row) => can('persediaan', 'U') ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openForm(row) }, ['Ubah']) : null });
    }
    function openForm(row) {
      const isNew = !row;
      const fields = [{ key: 'nama', label: 'Nama Barang', required: true }, { key: 'satuan', label: 'Satuan', required: true },
        isNew ? { key: 'stok_awal', label: 'Stok Awal', type: 'number' } : null, { key: 'stok_minimum', label: 'Stok Minimum', type: 'number' }].filter(Boolean);
      const form = UI.buildForm(fields, row || {});
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const v = form.getValues(); if (!isNew) v.id_barang = row.id_barang; const res = await api('persediaanSave', v); UI.toast(res.message, res.success ? 'success' : 'error'); if (res.success) { UI.closeModal(); load(true); } } }, ['Simpan']);
      UI.openModal((isNew ? 'Tambah' : 'Ubah') + ' Barang Persediaan', form.node, footBtn);
    }
    function openStok(tipe) {
      const opts = rows.map(r => ({ value: r.id_barang, label: r.nama + ' (stok: ' + r.stok_saat_ini + ' ' + r.satuan + ')' }));
      const fields = [{ key: 'id_barang', label: 'Barang', type: 'select', options: opts, required: true }, { key: 'jumlah', label: 'Jumlah', type: 'number', required: true }, { key: 'tanggal', label: 'Tanggal', type: 'date', required: true }];
      const form = UI.buildForm(fields, { tanggal: new Date().toISOString().slice(0, 10) });
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const res = await api(tipe === 'masuk' ? 'stokMasuk' : 'stokKeluar', form.getValues()); UI.toast(res.message, res.success ? 'success' : 'error'); if (res.success) { UI.closeModal(); load(true); } } }, ['Simpan']);
      UI.openModal('Barang ' + (tipe === 'masuk' ? 'Masuk' : 'Keluar'), form.node, footBtn);
    }
    function openOpname() {
      const opts = rows.map(r => ({ value: r.id_barang, label: r.nama }));
      const fields = [{ key: 'id_barang', label: 'Barang', type: 'select', options: opts, required: true }, { key: 'stokFisik', label: 'Stok Fisik (hasil hitung)', type: 'number', required: true }];
      const form = UI.buildForm(fields, {});
      const hasilEl = el('div', { class: 'hint mt-8' }, ['']);
      form.node.appendChild(hasilEl);
      const footBtn = el('div', { class: 'flex gap-8' }, [
        el('button', { class: 'btn btn-secondary', onclick: async () => { const r = await api('stockOpname', form.getValues()); if (r.success) hasilEl.textContent = 'Stok aplikasi: ' + r.data.stokAplikasi + ' · Stok fisik: ' + r.data.stokFisik + ' · Selisih: ' + r.data.selisih; } }, ['Hitung Selisih']),
        el('button', { class: 'btn btn-primary', onclick: async () => { const v = form.getValues(); v.terapkan = true; const r = await api('stockOpname', v); UI.toast(r.success ? 'Stok disesuaikan.' : r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Terapkan Penyesuaian'])
      ]);
      UI.openModal('Stock Opname', form.node, footBtn);
    }
    load();
  }

  async function renderLabelQr(mount) {
    mount.appendChild(el('div', { class: 'desc mt-8' }, ['Pilih aset untuk membuat label QR. QR dibuat di perangkat Anda lalu dicetak sebagai PDF melalui server.']));
    const res = await apiList('asetList', {});
    const rows = res.success ? res.data : [];
    const sel = el('select', {}, rows.map(r => el('option', { value: r.id_aset }, [r.id_aset + ' — ' + r.nama])));
    const qrHolder = el('canvas', { id: 'qrCanvas', width: 180, height: 180 });
    const box = el('div', { class: 'qr-box mt-16', style: 'max-width:280px' }, [qrHolder, el('div', { class: 'mono', id: 'qrCodeText' }, [''])]);
    const btnCetak = el('button', { class: 'btn btn-primary mt-16', onclick: cetak }, ['Cetak Label PDF']);
    mount.appendChild(el('div', { class: 'card', style: 'max-width:420px' }, [el('div', { class: 'field' }, [el('label', {}, ['Aset']), sel]), box, btnCetak]));
    function drawQr() {
      const id = sel.value; if (!id) return;
      qrHolder.getContext('2d').clearRect(0, 0, 180, 180);
      const qr = qrcode(0, 'M'); qr.addData(id); qr.make();
      const modules = qr.getModuleCount(); const cell = Math.floor(180 / modules);
      const ctx2d = qrHolder.getContext('2d'); ctx2d.fillStyle = '#fff'; ctx2d.fillRect(0, 0, 180, 180); ctx2d.fillStyle = '#000';
      for (let r = 0; r < modules; r++) for (let c = 0; c < modules; c++) if (qr.isDark(r, c)) ctx2d.fillRect(c * cell, r * cell, cell, cell);
      document.getElementById('qrCodeText').textContent = id;
    }
    sel.addEventListener('change', drawQr);
    if (rows.length) drawQr();
    function cetak() {
      const id = sel.value; if (!id) return;
      const aset = rows.find(r => r.id_aset === id);
      const qrBase64 = qrHolder.toDataURL('image/png');
      const previewImg = el('img', { src: qrBase64, style: 'width:120px;height:120px;display:block;margin:0 auto 8px' });
      previewCetak({
        judul: 'Label QR — ' + id,
        extraNode: previewImg,
        columns: [{ key: 'field', label: 'Field' }, { key: 'value', label: 'Isi' }],
        rows: [{ field: 'Kode Aset', value: id }, { field: 'Nama Aset', value: aset ? aset.nama : '-' }],
        onCetak: async () => {
          const r = await api('cetak_label_qr', { id_aset: id, qrBase64 });
          if (r.success) window.open(r.data.url, '_blank');
          UI.toast(r.success ? 'Label PDF dibuat.' : r.message, r.success ? 'success' : 'error');
        }
      });
    }
  }

  // ------------------------------------------------------------------
  // 3) TRANSAKSI & BERITA ACARA
  // ------------------------------------------------------------------
  async function renderTransaksi(mount) {
    if (!guardModul(mount, 'transaksi')) return;
    let tab = 'masuk';
    pageHead(mount, 'Transaksi & Berita Acara', 'Barang masuk, keluar, dan dokumen serah terima');
    const tabsMount = section(mount), bodyMount = section(mount);
    draw();
    function draw() {
      tabsMount.innerHTML = '';
      tabsBar(tabsMount, [{ id: 'masuk', label: 'Barang Masuk' }, { id: 'keluar', label: 'Barang Keluar' }, { id: 'ba', label: 'Berita Acara' }], tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      if (tab === 'masuk') listOnly(bodyMount, 'transaksiMasukList', [{ key: 'id_transaksi', label: 'ID', type: 'code' }, { key: 'tanggal', label: 'Tanggal', type: 'tanggal' }, { key: 'id_ref', label: 'Barang/Aset' }, { key: 'jumlah', label: 'Jumlah', type: 'num' }, { key: 'no_dokumen_sumber', label: 'No. Dokumen' }]);
      else if (tab === 'keluar') listOnly(bodyMount, 'transaksiKeluarList', [{ key: 'id_transaksi', label: 'ID', type: 'code' }, { key: 'tanggal', label: 'Tanggal', type: 'tanggal' }, { key: 'id_barang', label: 'Barang' }, { key: 'jumlah', label: 'Jumlah', type: 'num' }, { key: 'id_pemohon', label: 'Pemohon' }]);
      else renderBeritaAcara(bodyMount);
    }
  }
  async function listOnly(mount, action, columns) {
    const tableMount = section(mount);
    const res = await apiList(action, {});
    UI.dataTable(tableMount, columns, res.success ? res.data : []);
  }
  async function renderBeritaAcara(mount) {
    const toolbar = can('berita_acara', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Buat Berita Acara']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    let rows = [];
    async function load(force) { const res = await apiList('beritaAcaraList', {}, { force }); rows = res.success ? res.data : []; draw(); }
    function draw() {
      tableMount.innerHTML = '';
      UI.dataTable(tableMount, [
        { key: 'nomor_ba', label: 'Nomor', type: 'code' }, { key: 'jenis', label: 'Jenis' }, { key: 'tanggal', label: 'Tanggal', type: 'tanggal' },
        { key: 'pihak_1', label: 'Pihak 1' }, { key: 'pihak_2', label: 'Pihak 2' }
      ], rows, { actions: (row) => el('button', { class: 'btn btn-secondary btn-sm', onclick: () => cetak(row) }, ['Cetak PDF']) });
    }
    function cetak(row) {
      previewCetak({
        judul: 'Berita Acara ' + row.nomor_ba,
        columns: [{ key: 'field', label: 'Field' }, { key: 'value', label: 'Isi' }],
        rows: [
          { field: 'Nomor BA', value: row.nomor_ba }, { field: 'Jenis', value: row.jenis }, { field: 'Tanggal', value: UI.tgl(row.tanggal) },
          { field: 'Pihak 1 (Penyerah)', value: row.pihak_1 }, { field: 'Pihak 2 (Penerima)', value: row.pihak_2 }, { field: 'Ringkasan', value: row.ringkasan || '-' }
        ],
        onCetak: async () => { const r = await api('cetak_berita_acara', { id_ba: row.id_ba }); if (r.success) window.open(r.data.url, '_blank'); UI.toast(r.success ? 'PDF dibuat.' : r.message, r.success ? 'success' : 'error'); if (r.success) load(true); }
      });
    }
    function openForm() {
      const fields = [
        { key: 'jenis', label: 'Jenis', type: 'select', options: [{ value: 'Serah Terima Barang', label: 'Serah Terima Barang' }, { value: 'Mutasi', label: 'Mutasi' }, { value: 'Pemusnahan', label: 'Pemusnahan' }], required: true },
        { key: 'tanggal', label: 'Tanggal', type: 'date', required: true }, { key: 'pihak_1', label: 'Pihak 1 (Penyerah)', required: true },
        { key: 'pihak_2', label: 'Pihak 2 (Penerima)', required: true }, { key: 'ringkasan', label: 'Ringkasan', type: 'textarea', span2: true }
      ];
      const form = UI.buildForm(fields, { tanggal: new Date().toISOString().slice(0, 10) });
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('beritaAcaraSave', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Simpan']);
      UI.openModal('Berita Acara Baru', form.node, footBtn);
    }
    load();
  }

  // ------------------------------------------------------------------
  // 4) PERMINTAAN, PEMINJAMAN, MUTASI, PENGHAPUSAN + PERSETUJUAN
  // ------------------------------------------------------------------
  async function renderAlur(mount) {
    let tab = 'permintaan';
    pageHead(mount, 'Permintaan & Persetujuan', 'Permintaan barang, peminjaman, mutasi, dan penghapusan aset');
    const tabsMount = section(mount), bodyMount = section(mount);
    const tabs = [{ id: 'permintaan', label: 'Permintaan Barang' }, { id: 'peminjaman', label: 'Peminjaman' }, { id: 'mutasi', label: 'Mutasi' }, { id: 'penghapusan', label: 'Penghapusan' }];
    if (can('permintaan', 'A') || can('peminjaman', 'A') || can('mutasi', 'A') || can('penghapusan', 'A')) tabs.push({ id: 'persetujuan', label: 'Antrean Persetujuan' });
    draw();
    function draw() {
      tabsMount.innerHTML = ''; tabsBar(tabsMount, tabs, tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      if (tab === 'permintaan') renderPermintaan(bodyMount);
      else if (tab === 'peminjaman') renderPeminjaman(bodyMount);
      else if (tab === 'mutasi') renderMutasi(bodyMount);
      else if (tab === 'penghapusan') renderPenghapusan(bodyMount);
      else renderPersetujuan(bodyMount);
    }
  }

  async function renderPermintaan(mount) {
    const ref = await loadRefData();
    const pegawaiOpts = ref.pegawai.map(p => ({ value: p.id_pegawai, label: p.nama + ' (' + p.jabatan + ')' }));
    const toolbar = can('permintaan', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Ajukan Permintaan']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) { const r = await apiList('permintaanList', {}, { force }); UI.dataTable(tableMount, [
      { key: 'id_permintaan', label: 'ID', type: 'code' }, { key: 'jenis', label: 'Jenis' }, { key: 'id_pemohon', label: 'Pemohon' },
      { key: 'status', label: 'Status', type: 'badge' }, { key: 'dibuat_at', label: 'Diajukan', type: 'tanggal' }, { key: 'catatan', label: 'Catatan Kepsek' }
    ], r.success ? r.data : []); }
    function openForm() {
      const persedRef = {};
      const fields = [
        { key: 'jenis', label: 'Jenis', type: 'select', options: [{ value: 'Barang Habis Pakai', label: 'Barang Habis Pakai' }, { value: 'Usulan Kebutuhan', label: 'Usulan Kebutuhan' }], required: true },
        { key: 'id_pemohon', label: 'Pemohon', type: 'select', options: pegawaiOpts, required: true },
        { key: 'id_barang', label: 'Barang (bila Barang Habis Pakai)' }, { key: 'jumlah', label: 'Jumlah', type: 'number' },
        { key: 'deskripsi', label: 'Deskripsi Usulan (bila Usulan Kebutuhan)', type: 'textarea', span2: true }
      ];
      const form = UI.buildForm(fields, {});
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('permintaanAjukan', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Ajukan']);
      UI.openModal('Ajukan Permintaan', form.node, footBtn);
    }
    load();
  }

  async function renderPeminjaman(mount) {
    const ref = await loadRefData();
    const pegawaiOpts = ref.pegawai.map(p => ({ value: p.id_pegawai, label: p.nama }));
    const asetRes = await apiList('asetList', {}); const asetOpts = (asetRes.success ? asetRes.data : []).filter(a => a.status === 'Tersedia').map(a => ({ value: a.id_aset, label: a.id_aset + ' — ' + a.nama }));
    const toolbar = can('peminjaman', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Ajukan Peminjaman']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) {
      const r = await apiList('peminjamanList', {}, { force });
      UI.dataTable(tableMount, [
        { key: 'id_pinjam', label: 'ID', type: 'code' }, { key: 'id_aset', label: 'Aset' }, { key: 'id_peminjam', label: 'Peminjam' },
        { key: 'tgl_pinjam', label: 'Tgl Pinjam', type: 'tanggal' }, { key: 'tgl_rencana_kembali', label: 'Rencana Kembali', type: 'tanggal' }, { key: 'status', label: 'Status', type: 'badge' }
      ], r.success ? r.data : [], { actions: (row) => (can('peminjaman', 'U') && row.status === 'Disetujui') ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openKembali(row) }, ['Kembalikan']) : null });
    }
    function openForm() {
      const fields = [{ key: 'id_aset', label: 'Aset', type: 'select', options: asetOpts, required: true }, { key: 'id_peminjam', label: 'Peminjam', type: 'select', options: pegawaiOpts, required: true },
        { key: 'tgl_pinjam', label: 'Tanggal Pinjam', type: 'date', required: true }, { key: 'tgl_rencana_kembali', label: 'Rencana Kembali', type: 'date', required: true }];
      const form = UI.buildForm(fields, { tgl_pinjam: new Date().toISOString().slice(0, 10) });
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('peminjamanAjukan', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Ajukan']);
      UI.openModal('Ajukan Peminjaman', form.node, footBtn);
    }
    function openKembali(row) {
      const fields = [{ key: 'tgl_kembali', label: 'Tanggal Kembali', type: 'date', required: true }, { key: 'kondisi_saat_kembali', label: 'Kondisi Saat Kembali', type: 'select', options: [{ value: 'Baik', label: 'Baik' }, { value: 'Rusak Ringan', label: 'Rusak Ringan' }, { value: 'Rusak Berat', label: 'Rusak Berat' }], required: true }];
      const form = UI.buildForm(fields, { tgl_kembali: new Date().toISOString().slice(0, 10) });
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const v = form.getValues(); v.id_pinjam = row.id_pinjam; const r = await api('peminjamanKembalikan', v); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Simpan']);
      UI.openModal('Pengembalian Aset', form.node, footBtn);
    }
    load();
  }

  async function renderMutasi(mount) {
    const ref = await loadRefData();
    const ruanganOpts = ref.ruangan.map(r => ({ value: r.id_ruangan, label: r.nama_ruangan }));
    const asetRes = await apiList('asetList', {}); const asetOpts = (asetRes.success ? asetRes.data : []).map(a => ({ value: a.id_aset, label: a.id_aset + ' — ' + a.nama }));
    const toolbar = can('mutasi', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Ajukan Mutasi']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) { const r = await apiList('mutasiList', {}, { force }); UI.dataTable(tableMount, [
      { key: 'id_mutasi', label: 'ID', type: 'code' }, { key: 'id_aset', label: 'Aset' }, { key: 'asal', label: 'Asal', render: row => ref.ruangan.find(x => x.id_ruangan === row.asal)?.nama_ruangan || row.asal },
      { key: 'tujuan', label: 'Tujuan', render: row => ref.ruangan.find(x => x.id_ruangan === row.tujuan)?.nama_ruangan || row.tujuan }, { key: 'tanggal', label: 'Tanggal', type: 'tanggal' }, { key: 'status', label: 'Status', type: 'badge' }
    ], r.success ? r.data : []); }
    function openForm() {
      const fields = [{ key: 'id_aset', label: 'Aset', type: 'select', options: asetOpts, required: true }, { key: 'tujuan', label: 'Ruangan Tujuan', type: 'select', options: ruanganOpts, required: true }, { key: 'tanggal', label: 'Tanggal', type: 'date', required: true }];
      const form = UI.buildForm(fields, { tanggal: new Date().toISOString().slice(0, 10) });
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('mutasiAjukan', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Ajukan']);
      UI.openModal('Ajukan Mutasi Aset', form.node, footBtn);
    }
    load();
  }

  async function renderPenghapusan(mount) {
    const asetRes = await apiList('asetList', {}); const asetOpts = (asetRes.success ? asetRes.data : []).map(a => ({ value: a.id_aset, label: a.id_aset + ' — ' + a.nama }));
    const toolbar = can('penghapusan', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Usulkan Penghapusan']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) { const r = await apiList('penghapusanList', {}, { force }); UI.dataTable(tableMount, [
      { key: 'id_hapus', label: 'ID', type: 'code' }, { key: 'id_aset', label: 'Aset' }, { key: 'metode', label: 'Metode' }, { key: 'alasan', label: 'Alasan' }, { key: 'status', label: 'Status', type: 'badge' }
    ], r.success ? r.data : []); }
    function openForm() {
      const fields = [{ key: 'id_aset', label: 'Aset', type: 'select', options: asetOpts, required: true }, { key: 'metode', label: 'Metode', type: 'select', options: [{ value: 'jual', label: 'Jual' }, { value: 'hibah', label: 'Hibah' }, { value: 'musnah', label: 'Musnah' }], required: true }, { key: 'no_sk', label: 'Nomor SK' }, { key: 'alasan', label: 'Alasan', type: 'textarea', span2: true, required: true }];
      const form = UI.buildForm(fields, {});
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('penghapusanAjukan', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Usulkan']);
      UI.openModal('Usulkan Penghapusan Aset', form.node, footBtn);
    }
    load();
  }

  async function renderPersetujuan(mount) {
    mount.appendChild(el('div', { class: 'authority-panel' }, [
      el('div', { class: 'ap-head' }, ['Lembar Pengesahan Kepala Sekolah']),
      el('div', { class: 'ap-body desc' }, ['Semua pengajuan menunggu keputusan Anda sebagai Kepala Sekolah.'])
    ]));
    const tableMount = section(mount);
    async function load(force) {
      // Antrean persetujuan bisa berubah dari aksi admin lain — jendela segar lebih pendek (10dtk).
      const r = await apiList('antreanPersetujuan', {}, { force, fresh: 10000 });
      const rows = r.success ? r.data : [];
      UI.dataTable(tableMount, [
        { key: 'tipe', label: 'Tipe', type: 'badge' }, { key: 'id_aset', label: 'Aset/Barang', render: row => row.id_aset || row.id_permintaan || '-' },
        { key: 'dibuat_oleh', label: 'Diajukan Oleh' }, { key: 'dibuat_at', label: 'Tanggal', type: 'tanggal' }
      ], rows, {
        actions: (row) => el('div', { class: 'flex gap-8' }, [
          el('button', { class: 'btn btn-authority btn-sm', onclick: () => putuskan(row, 'Disetujui') }, ['Setujui']),
          el('button', { class: 'btn btn-destructive btn-sm', onclick: () => putuskan(row, 'Ditolak') }, ['Tolak'])
        ])
      });
    }
    function idOf(row) {
      return row.tipe === 'permintaan' ? row.id_permintaan : row.tipe === 'peminjaman' ? row.id_pinjam : row.tipe === 'mutasi' ? row.id_mutasi : row.id_hapus;
    }
    async function putuskan(row, keputusan) {
      const catatan = keputusan === 'Ditolak' ? (window.prompt('Catatan penolakan (opsional):') || '') : '';
      const r = await api('setujuiPengajuan', { tipe: row.tipe, id: idOf(row), keputusan, catatan });
      UI.toast(r.message, r.success ? 'success' : 'error');
      if (r.success) load(true);
    }
    load();
  }

  // ------------------------------------------------------------------
  // 5) PEMELIHARAAN & TIKET KERUSAKAN
  // ------------------------------------------------------------------
  async function renderPemeliharaan(mount) {
    let tab = 'kerusakan';
    pageHead(mount, 'Pemeliharaan & Tiket', 'Jadwal servis dan laporan kerusakan');
    const tabsMount = section(mount), bodyMount = section(mount);
    draw();
    function draw() {
      tabsMount.innerHTML = ''; tabsBar(tabsMount, [{ id: 'kerusakan', label: 'Lapor Kerusakan' }, { id: 'servis', label: 'Jadwal Servis' }], tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      if (tab === 'kerusakan') renderKerusakan(bodyMount); else renderServis(bodyMount);
    }
  }
  async function renderKerusakan(mount) {
    const asetRes = await apiList('asetList', {}); const asetOpts = (asetRes.success ? asetRes.data : []).map(a => ({ value: a.id_aset, label: a.id_aset + ' — ' + a.nama }));
    const toolbar = can('kerusakan', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Lapor Kerusakan']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) { const r = await apiList('kerusakanList', {}, { force }); UI.dataTable(tableMount, [
      { key: 'id_tiket', label: 'Tiket', type: 'code' }, { key: 'id_aset', label: 'Aset' }, { key: 'deskripsi', label: 'Deskripsi' }, { key: 'tanggal_lapor', label: 'Dilaporkan', type: 'tanggal' }, { key: 'status', label: 'Status', type: 'badge' }
    ], r.success ? r.data : [], { actions: (row) => can('kerusakan', 'U') ? el('select', {
      onchange: async (e) => { const res = await api('kerusakanUpdateStatus', { id_tiket: row.id_tiket, status: e.target.value }); UI.toast(res.message, res.success ? 'success' : 'error'); if (res.success) load(true); }
    }, ['Baru', 'Ditangani', 'Selesai'].map(s => el('option', { value: s, selected: s === row.status ? 'selected' : null }, [s]))) : null }); }
    function openForm() {
      const fields = [{ key: 'id_aset', label: 'Aset', type: 'select', options: asetOpts, required: true }, { key: 'deskripsi', label: 'Deskripsi Kerusakan', type: 'textarea', required: true, span2: true }];
      const form = UI.buildForm(fields, {});
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('kerusakanLapor', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Lapor']);
      UI.openModal('Lapor Kerusakan', form.node, footBtn);
    }
    load();
  }
  async function renderServis(mount) {
    const asetRes = await apiList('asetList', {}); const asetOpts = (asetRes.success ? asetRes.data : []).map(a => ({ value: a.id_aset, label: a.id_aset + ' — ' + a.nama }));
    const vendorRes = await apiList('vendorList', {}); const vendorOpts = (vendorRes.success ? vendorRes.data : []).map(v => ({ value: v.id_vendor, label: v.nama }));
    const toolbar = can('pemeliharaan', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Jadwalkan Servis']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) {
      const r = await apiList('pemeliharaanList', {}, { force });
      UI.dataTable(tableMount, [
        { key: 'id_pemeliharaan', label: 'ID', type: 'code' }, { key: 'id_aset', label: 'Aset' }, { key: 'jenis', label: 'Jenis' },
        { key: 'tanggal_servis', label: 'Tgl Servis', type: 'tanggal' }, { key: 'jadwal_berikutnya', label: 'Jadwal Berikutnya', type: 'tanggal' },
        { key: 'biaya', label: 'Biaya', type: 'rupiah' }, { key: 'status_kapitalisasi', label: 'Kapitalisasi', type: 'badge' }
      ], r.success ? r.data : []);
    }
    function openForm() {
      const fields = [{ key: 'id_aset', label: 'Aset', type: 'select', options: asetOpts, required: true }, { key: 'jenis', label: 'Jenis Servis', required: true },
        { key: 'tanggal_servis', label: 'Tanggal Servis', type: 'date', required: true }, { key: 'jadwal_berikutnya', label: 'Jadwal Berikutnya', type: 'date' },
        { key: 'biaya', label: 'Biaya (Rp)', type: 'number' }, { key: 'id_vendor', label: 'Vendor', type: 'select', options: vendorOpts }];
      const form = UI.buildForm(fields, { tanggal_servis: new Date().toISOString().slice(0, 10) });
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('pemeliharaanJadwalkan', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Simpan']);
      UI.openModal('Jadwalkan Pemeliharaan', form.node, footBtn);
    }
    load();
  }

  // ------------------------------------------------------------------
  // 6) KEUANGAN & REKONSILIASI (Bendahara)
  // ------------------------------------------------------------------
  async function renderKeuangan(mount) {
    let tab = 'dokumen';
    pageHead(mount, 'Keuangan & Rekonsiliasi', 'Verifikasi dokumen sumber, rekonsiliasi nilai aset, kapitalisasi');
    const tabsMount = section(mount), bodyMount = section(mount);
    draw();
    function draw() {
      tabsMount.innerHTML = ''; tabsBar(tabsMount, [{ id: 'dokumen', label: 'Verifikasi Dokumen' }, { id: 'rekon', label: 'Rekonsiliasi' }, { id: 'kapitalisasi', label: 'Kapitalisasi' }], tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      if (tab === 'dokumen') renderDokKeuangan(bodyMount); else if (tab === 'rekon') renderRekonsiliasi(bodyMount); else renderKapitalisasi(bodyMount);
    }
  }
  async function renderDokKeuangan(mount) {
    const toolbar = can('dokumen_keuangan', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Catat Dokumen']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) { const r = await apiList('dokKeuanganList', {}, { force }); UI.dataTable(tableMount, [
      { key: 'jenis', label: 'Jenis' }, { key: 'nomor', label: 'Nomor', type: 'code' }, { key: 'tanggal', label: 'Tanggal', type: 'tanggal' },
      { key: 'nominal', label: 'Nominal', type: 'rupiah' }, { key: 'status_verifikasi', label: 'Status', type: 'badge' }
    ], r.success ? r.data : [], { actions: (row) => (can('dokumen_keuangan', 'U') && (row.status_verifikasi === 'Belum' || !row.status_verifikasi)) ? el('div', { class: 'flex gap-8' }, [
      el('button', { class: 'btn btn-secondary btn-sm', onclick: () => verif(row, 'Sesuai') }, ['Sesuai']),
      el('button', { class: 'btn btn-destructive btn-sm', onclick: () => verif(row, 'Tidak Sesuai') }, ['Tidak Sesuai'])
    ]) : null }); }
    async function verif(row, status) { const r = await api('dokKeuanganVerifikasi', { id_dok: row.id_dok, status_verifikasi: status }); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) load(true); }
    function openForm() {
      const fields = [{ key: 'jenis', label: 'Jenis', type: 'select', options: [{ value: 'Kuitansi', label: 'Kuitansi' }, { value: 'SP2D', label: 'SP2D' }, { value: 'SPM', label: 'SPM' }], required: true },
        { key: 'nomor', label: 'Nomor Dokumen', required: true }, { key: 'tanggal', label: 'Tanggal', type: 'date', required: true }, { key: 'nominal', label: 'Nominal (Rp)', type: 'number', required: true }];
      const form = UI.buildForm(fields, { tanggal: new Date().toISOString().slice(0, 10) });
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('dokKeuanganSave', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Simpan']);
      UI.openModal('Catat Dokumen Keuangan', form.node, footBtn);
    }
    load();
  }
  async function renderRekonsiliasi(mount) {
    const toolbar = can('rekonsiliasi', 'C') ? el('button', { class: 'btn btn-primary', onclick: openForm }, ['+ Rekonsiliasi Baru']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) { const r = await apiList('rekonsiliasiList', {}, { force }); UI.dataTable(tableMount, [
      { key: 'periode', label: 'Periode' }, { key: 'total_nilai_fisik', label: 'Nilai Fisik (Aplikasi)', type: 'rupiah' },
      { key: 'total_nilai_neraca', label: 'Nilai Neraca', type: 'rupiah' }, { key: 'selisih', label: 'Selisih', type: 'rupiah' }, { key: 'catatan', label: 'Catatan' }
    ], r.success ? r.data : []); }
    function openForm() {
      const fields = [{ key: 'periode', label: 'Periode (mis. 2026-Q3)', required: true }, { key: 'total_nilai_neraca', label: 'Total Nilai Neraca (Rp)', type: 'number', required: true }, { key: 'catatan', label: 'Catatan', type: 'textarea', span2: true }];
      const form = UI.buildForm(fields, {});
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const r = await api('rekonsiliasiSimpan', form.getValues()); UI.toast(r.success ? ('Tersimpan. Selisih: ' + UI.rupiah(r.data.selisih)) : r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Hitung & Simpan']);
      UI.openModal('Rekonsiliasi Aset & Keuangan', form.node, footBtn);
    }
    load();
  }
  async function renderKapitalisasi(mount) {
    const tableMount = section(mount);
    async function load(force) {
      const r = await apiList('pemeliharaanList', {}, { force });
      const rows = (r.success ? r.data : []).filter(p => p.status_kapitalisasi === 'Belum Diputuskan');
      UI.dataTable(tableMount, [
        { key: 'id_pemeliharaan', label: 'ID', type: 'code' }, { key: 'id_aset', label: 'Aset' }, { key: 'jenis', label: 'Jenis' }, { key: 'biaya', label: 'Biaya', type: 'rupiah' }
      ], rows, { actions: (row) => can('kapitalisasi', 'A') ? el('div', { class: 'flex gap-8' }, [
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => putuskan(row, true) }, ['Kapitalisasi']),
        el('button', { class: 'btn btn-destructive btn-sm', onclick: () => putuskan(row, false) }, ['Beban Saja'])
      ]) : null });
    }
    async function putuskan(row, dikapitalisasi) { const r = await api('kapitalisasiSetujui', { id_pemeliharaan: row.id_pemeliharaan, dikapitalisasi }); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) load(true); }
    load();
  }

  // ------------------------------------------------------------------
  // 7) LAPORAN & CETAK
  // ------------------------------------------------------------------
  async function renderLaporan(mount) {
    let tab = 'kib';
    pageHead(mount, 'Laporan & Dokumen Kedinasan', 'KIB, KIR, Buku Inventaris, Mutasi, Penyusutan');
    const tabsMount = section(mount), bodyMount = section(mount);
    const tabs = [{ id: 'kib', label: 'KIB' }, { id: 'kir', label: 'KIR' }, { id: 'buku', label: 'Buku Inventaris' }, { id: 'mutasi', label: 'Mutasi' }, { id: 'penyusutan', label: 'Penyusutan' }];
    draw();
    function draw() {
      tabsMount.innerHTML = ''; tabsBar(tabsMount, tabs, tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      const map = { kib: laporanKIB, kir: laporanKIR, buku: laporanBuku, mutasi: laporanMutasi, penyusutan: laporanPenyusutan };
      map[tab](bodyMount);
    }
  }
  async function laporanKIB(mount) {
    const ref = await loadRefData();
    const opts = [{ value: '', label: 'Semua Kategori' }].concat(ref.kategori.filter(k => k.jenis === 'Aset Tetap').map(k => ({ value: k.kode_barang, label: k.kode_barang + ' — ' + k.nama_kategori })));
    const sel = el('select', { style: 'max-width:260px' }, opts.map(o => el('option', { value: o.value }, [o.label])));
    const btnCetak = el('button', { class: 'btn btn-primary', onclick: cetak }, ['Cetak PDF']);
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [sel, btnCetak]));
    const tableMount = section(mount), totalEl = el('div', { class: 'mt-8 muted' }, ['']); mount.appendChild(totalEl);
    const kolomKIB = [{ key: 'id_aset', label: 'Kode Aset', type: 'code' }, { key: 'nama', label: 'Nama' }, { key: 'tahun_perolehan', label: 'Tahun' }, { key: 'nilai_perolehan', label: 'Nilai', type: 'rupiah' }, { key: 'kondisi', label: 'Kondisi', type: 'badge' }];
    let lastData = { rows: [], total: 0 };
    async function load() { const r = await api('laporanKIB', { kategori: sel.value }); lastData = r.success ? r.data : { rows: [], total: 0 }; totalEl.textContent = 'Total nilai: ' + UI.rupiah(lastData.total); UI.dataTable(tableMount, kolomKIB, lastData.rows); }
    function cetak() {
      const labelKategori = opts.find(o => o.value === sel.value);
      previewCetak({
        judul: 'KIB — ' + (labelKategori ? labelKategori.label : 'Semua Kategori'),
        infoLines: [lastData.rows.length + ' item', 'Total nilai: ' + UI.rupiah(lastData.total)],
        columns: kolomKIB, rows: lastData.rows,
        onCetak: async () => { const r = await api('cetak_kib', { kategori: sel.value }); if (r.success) window.open(r.data.url, '_blank'); UI.toast(r.success ? 'PDF dibuat.' : r.message, r.success ? 'success' : 'error'); }
      });
    }
    sel.addEventListener('change', load); load();
  }
  async function laporanKIR(mount) {
    const ref = await loadRefData();
    const sel = el('select', { style: 'max-width:260px' }, ref.ruangan.map(r => el('option', { value: r.id_ruangan }, [r.nama_ruangan])));
    const btnCetak = el('button', { class: 'btn btn-primary', onclick: cetak }, ['Cetak PDF']);
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [sel, btnCetak]));
    const tableMount = section(mount);
    const kolomKIR = [{ key: 'id_aset', label: 'Kode Aset', type: 'code' }, { key: 'nama', label: 'Nama' }, { key: 'kondisi', label: 'Kondisi', type: 'badge' }];
    let lastRows = [];
    async function load() { const r = await api('laporanKIR', { ruangan: sel.value }); const data = (r.success ? r.data : [])[0]; lastRows = data ? data.aset : []; UI.dataTable(tableMount, kolomKIR, lastRows); }
    function cetak() {
      const ruanganSel = ref.ruangan.find(x => x.id_ruangan === sel.value);
      previewCetak({
        judul: 'KIR — ' + (ruanganSel ? ruanganSel.nama_ruangan : sel.value),
        infoLines: [lastRows.length + ' item'],
        columns: kolomKIR, rows: lastRows,
        onCetak: async () => { const r = await api('cetak_kir', { ruangan: sel.value }); if (r.success) window.open(r.data.url, '_blank'); UI.toast(r.success ? 'PDF dibuat.' : r.message, r.success ? 'success' : 'error'); }
      });
    }
    sel.addEventListener('change', load); if (ref.ruangan.length) load();
  }
  async function laporanBuku(mount) {
    const btnCetak = el('button', { class: 'btn btn-primary', onclick: cetak }, ['Cetak PDF']);
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [btnCetak]));
    const tableMount = section(mount);
    const kolomBuku = [{ key: 'id_aset', label: 'Kode', type: 'code' }, { key: 'nama', label: 'Nama' }, { key: 'kode_barang', label: 'Kategori' }, { key: 'tahun_perolehan', label: 'Tahun' }, { key: 'nilai_perolehan', label: 'Nilai', type: 'rupiah' }, { key: 'status', label: 'Status', type: 'badge' }];
    const r = await api('laporanBukuInventaris', {});
    const rows = r.success ? r.data : [];
    UI.dataTable(tableMount, kolomBuku, rows);
    function cetak() {
      previewCetak({
        judul: 'Buku Inventaris', infoLines: [rows.length + ' item'], columns: kolomBuku, rows: rows,
        onCetak: async () => { const res = await api('cetak_buku_inventaris', {}); if (res.success) window.open(res.data.url, '_blank'); UI.toast(res.success ? 'PDF dibuat.' : res.message, res.success ? 'success' : 'error'); }
      });
    }
  }
  async function laporanMutasi(mount) {
    const btnCetak = el('button', { class: 'btn btn-primary', onclick: cetak }, ['Cetak PDF']);
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [btnCetak]));
    const tableMount = section(mount);
    const kolomMutasi = [{ key: 'id_mutasi', label: 'ID', type: 'code' }, { key: 'id_aset', label: 'Aset' }, { key: 'asal', label: 'Asal' }, { key: 'tujuan', label: 'Tujuan' }, { key: 'tanggal', label: 'Tanggal', type: 'tanggal' }];
    const r = await api('laporanMutasi', {});
    const rows = r.success ? r.data : [];
    UI.dataTable(tableMount, kolomMutasi, rows);
    function cetak() {
      previewCetak({
        judul: 'Laporan Mutasi', infoLines: [rows.length + ' item'], columns: kolomMutasi, rows: rows,
        onCetak: async () => { const res = await api('cetak_mutasi', {}); if (res.success) window.open(res.data.url, '_blank'); UI.toast(res.success ? 'PDF dibuat.' : res.message, res.success ? 'success' : 'error'); }
      });
    }
  }
  async function laporanPenyusutan(mount) {
    const btnCetak = el('button', { class: 'btn btn-primary', onclick: cetak }, ['Cetak PDF']);
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [btnCetak]));
    const tableMount = section(mount);
    const kolomPenyusutan = [{ key: 'id_aset', label: 'Kode', type: 'code' }, { key: 'nama', label: 'Nama' }, { key: 'nilai_perolehan', label: 'Nilai Perolehan', type: 'rupiah' }, { key: 'akumulasi_penyusutan', label: 'Akumulasi Susut', type: 'rupiah' }, { key: 'nilai_buku', label: 'Nilai Buku', type: 'rupiah' }];
    const r = await api('laporanPenyusutan', {});
    const rows = r.success ? r.data : [];
    UI.dataTable(tableMount, kolomPenyusutan, rows);
    function cetak() {
      previewCetak({
        judul: 'Laporan Penyusutan', infoLines: [rows.length + ' item'], columns: kolomPenyusutan, rows: rows,
        onCetak: async () => { const res = await api('cetak_penyusutan', {}); if (res.success) window.open(res.data.url, '_blank'); UI.toast(res.success ? 'PDF dibuat.' : res.message, res.success ? 'success' : 'error'); }
      });
    }
  }

  // ------------------------------------------------------------------
  // 8) MASTER DATA, 9) PENGGUNA & LOG, 10) PENGATURAN
  // ------------------------------------------------------------------
  async function renderMaster(mount) {
    let tab = 'kategori';
    pageHead(mount, 'Master Data Pokok', 'Kategori barang, ruangan, vendor, pegawai');
    const tabsMount = section(mount), bodyMount = section(mount);
    const renderers = {
      kategori: crudSimple({ modul: 'master_data', title: 'Kategori Barang', idKey: 'kode_barang', listAction: 'kategoriList', saveAction: 'kategoriSave', toggleAction: 'kategoriToggle',
        columns: [{ key: 'kode_barang', label: 'Kode', type: 'code' }, { key: 'nama_kategori', label: 'Nama' }, { key: 'jenis', label: 'Jenis' }, { key: 'umur_ekonomis', label: 'Umur (th)' }, { key: 'aktif', label: 'Status', type: 'badge' }],
        fields: [{ key: 'kode_barang', label: 'Kode Barang (unik)', required: true }, { key: 'nama_kategori', label: 'Nama Kategori', required: true },
          { key: 'jenis', label: 'Jenis', type: 'select', options: [{ value: 'Aset Tetap', label: 'Aset Tetap' }, { value: 'Habis Pakai', label: 'Habis Pakai' }], required: true },
          { key: 'umur_ekonomis', label: 'Umur Ekonomis (tahun)', type: 'number' }, { key: 'metode_penyusutan', label: 'Metode Penyusutan' }] }),
      ruangan: crudSimple({ modul: 'master_data', title: 'Ruangan', idKey: 'id_ruangan', listAction: 'ruanganList', saveAction: 'ruanganSave', toggleAction: 'ruanganToggle',
        columns: [{ key: 'id_ruangan', label: 'ID', type: 'code' }, { key: 'gedung', label: 'Gedung' }, { key: 'lantai', label: 'Lantai' }, { key: 'nama_ruangan', label: 'Nama Ruangan' }, { key: 'penanggung_jawab', label: 'Penanggung Jawab' }, { key: 'aktif', label: 'Status', type: 'badge' }],
        fields: [{ key: 'gedung', label: 'Gedung', required: true }, { key: 'lantai', label: 'Lantai' }, { key: 'nama_ruangan', label: 'Nama Ruangan', required: true }, { key: 'penanggung_jawab', label: 'Penanggung Jawab' }] }),
      vendor: crudSimple({ modul: 'master_data', title: 'Vendor', idKey: 'id_vendor', listAction: 'vendorList', saveAction: 'vendorSave', toggleAction: 'vendorToggle',
        columns: [{ key: 'id_vendor', label: 'ID', type: 'code' }, { key: 'nama', label: 'Nama' }, { key: 'kontak', label: 'Kontak' }, { key: 'jenis_layanan', label: 'Jenis Layanan' }, { key: 'aktif', label: 'Status', type: 'badge' }],
        fields: [{ key: 'nama', label: 'Nama Vendor', required: true }, { key: 'alamat', label: 'Alamat' }, { key: 'kontak', label: 'Kontak' }, { key: 'jenis_layanan', label: 'Jenis Layanan' }] }),
      pegawai: crudSimple({ modul: 'master_data', title: 'Pegawai', idKey: 'id_pegawai', listAction: 'pegawaiList', saveAction: 'pegawaiSave', toggleAction: 'pegawaiToggle',
        columns: [{ key: 'id_pegawai', label: 'ID', type: 'code' }, { key: 'nama', label: 'Nama' }, { key: 'jabatan', label: 'Jabatan' }, { key: 'unit', label: 'Unit' }, { key: 'aktif', label: 'Status', type: 'badge' }],
        fields: [{ key: 'nama', label: 'Nama', required: true }, { key: 'jabatan', label: 'Jabatan', required: true }, { key: 'unit', label: 'Unit' }] })
    };
    draw();
    function draw() {
      tabsMount.innerHTML = ''; tabsBar(tabsMount, [{ id: 'kategori', label: 'Kategori Barang' }, { id: 'ruangan', label: 'Ruangan' }, { id: 'vendor', label: 'Vendor' }, { id: 'pegawai', label: 'Pegawai' }], tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = ''; renderers[tab](bodyMount);
    }
  }

  async function renderPenggunaLog(mount) {
    let tab = 'users';
    pageHead(mount, 'Pengguna & Log Audit', 'Manajemen akun dan jejak audit (read-only)');
    const tabsMount = section(mount), bodyMount = section(mount);
    draw();
    function draw() {
      tabsMount.innerHTML = ''; tabsBar(tabsMount, [{ id: 'users', label: 'Pengguna' }, { id: 'log', label: 'Log Aktivitas' }], tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      if (tab === 'users') renderUsers(bodyMount); else renderLog(bodyMount);
    }
  }
  async function renderUsers(mount) {
    if (!can('pengguna', 'R')) { mount.appendChild(el('div', { class: 'card' }, ['Tidak ada akses.'])); return; }
    const toolbar = can('pengguna', 'C') ? el('button', { class: 'btn btn-primary', onclick: () => openForm(null) }, ['+ Tambah Pengguna']) : null;
    mount.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:10px' }, [toolbar]));
    const tableMount = section(mount);
    async function load(force) { const r = await apiList('usersList', {}, { force }); UI.dataTable(tableMount, [
      { key: 'nama', label: 'Nama' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Peran' }, { key: 'status_aktif', label: 'Status', type: 'badge' }
    ], r.success ? r.data : [], { actions: (row) => el('div', { class: 'flex gap-8' }, [
      can('pengguna', 'U') ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openForm(row) }, ['Ubah']) : null,
      can('pengguna', 'D') ? el('button', { class: 'btn btn-destructive btn-sm', onclick: () => toggle(row) }, [row.status_aktif === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan']) : null
    ]) }); }
    async function toggle(row) { if (!UI.confirmDialog('Ubah status pengguna ini?')) return; const r = await api('usersToggle', { id_user: row.id_user }); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) load(true); }
    function openForm(row) {
      const isNew = !row;
      const fields = [{ key: 'nama', label: 'Nama', required: true }, { key: 'email', label: 'Email Google', required: true },
        { key: 'role', label: 'Peran', type: 'select', options: [{ value: 'SUPER_ADMIN', label: 'Super Admin' }, { value: 'STAF_INVENTARIS', label: 'Staf Inventaris' }, { value: 'BENDAHARA', label: 'Bendahara' }, { value: 'KEPALA_SEKOLAH', label: 'Kepala Sekolah' }], required: true }];
      const form = UI.buildForm(fields, row || {});
      const footBtn = el('button', { class: 'btn btn-primary', onclick: async () => { const v = form.getValues(); if (!isNew) v.id_user = row.id_user; const r = await api('usersSave', v); UI.toast(r.message, r.success ? 'success' : 'error'); if (r.success) { UI.closeModal(); load(true); } } }, ['Simpan']);
      UI.openModal((isNew ? 'Tambah' : 'Ubah') + ' Pengguna', form.node, footBtn);
    }
    load();
  }
  async function renderLog(mount) {
    const tableMount = section(mount);
    const r = await apiList('logList', {}, { fresh: 15000 });
    UI.dataTable(tableMount, [
      { key: 'timestamp', label: 'Waktu', render: row => UI.tglJam(row.timestamp) }, { key: 'email', label: 'Pengguna' }, { key: 'aksi', label: 'Aksi' }, { key: 'modul', label: 'Modul' }, { key: 'id_data', label: 'Data', type: 'code' }, { key: 'keterangan', label: 'Keterangan' }
    ], r.success ? r.data : []);
  }

  async function renderPengaturan(mount) {
    if (!guardModul(mount, 'pengaturan')) return;
    let tab = 'profil';
    pageHead(mount, 'Pengaturan Sistem', 'Profil instansi, backup data, dan template dokumen cetak');
    const tabsMount = section(mount), bodyMount = section(mount);
    draw();
    function draw() {
      tabsMount.innerHTML = ''; tabsBar(tabsMount, [{ id: 'profil', label: 'Profil Instansi' }, { id: 'template', label: 'Template Dokumen' }], tab, (id) => { tab = id; draw(); });
      bodyMount.innerHTML = '';
      if (tab === 'profil') renderPengaturanProfil(bodyMount); else renderTemplateDokumen(bodyMount);
    }
  }

  async function renderPengaturanProfil(mount) {
    const res = await apiList('pengaturanGet', {});
    const p = res.success ? res.data : {};
    const fields = [{ key: 'nama_instansi', label: 'Nama Instansi', required: true, span2: true }, { key: 'alamat', label: 'Alamat', span2: true },
      { key: 'kepala_sekolah', label: 'Nama Kepala Sekolah' }, { key: 'tahun_ajaran', label: 'Tahun Ajaran' }];
    const form = UI.buildForm(fields, p);
    const card = el('div', { class: 'card', style: 'max-width:620px' }, [form.node, el('button', { class: 'btn btn-primary mt-16', onclick: async () => { const r = await api('pengaturanSimpan', form.getValues()); UI.toast(r.message, r.success ? 'success' : 'error'); } }, ['Simpan Pengaturan'])]);
    mount.appendChild(card);
    const backupCard = el('div', { class: 'card mt-16', style: 'max-width:620px' }, [
      el('h3', { style: 'margin-top:0' }, ['Backup Data']),
      el('div', { class: 'desc' }, ['Backup terakhir: ' + (p.backup_terakhir ? UI.tglJam(p.backup_terakhir) : 'belum pernah')]),
      el('button', { class: 'btn btn-secondary mt-8', onclick: async (e) => { e.target.disabled = true; const r = await api('backupJalankan', {}); UI.toast(r.message, r.success ? 'success' : 'error'); e.target.disabled = false; } }, ['Jalankan Backup Sekarang'])
    ]);
    mount.appendChild(backupCard);
  }

  // ------------------------------------------------------------------
  // TEMPLATE DOKUMEN CETAK (PANDUAN-INSTALASI.md Bagian A7) — khusus Super Admin, karena
  // halaman Pengaturan Sistem sendiri sudah dibatasi modul 'pengaturan' (hanya Super Admin
  // punya akses R/U/C/D pada modul ini, lihat PERMS di Config.gs).
  // ------------------------------------------------------------------
  async function renderTemplateDokumen(mount) {
    mount.appendChild(el('div', { class: 'desc mt-8' }, [
      'Atur file Google Docs yang dipakai saat mencetak PDF (KIB, KIR, Buku Inventaris, Mutasi, Penyusutan, Berita Acara, Label QR). ' +
      'Tempel File ID atau link Google Docs yang sudah Anda buat, atau biarkan aplikasi membuatkan template awal otomatis.'
    ]));
    const tableMount = section(mount);
    async function load(force) {
      const r = await apiList('templateDokumenList', {}, { force, fresh: 30000 });
      const rows = r.success ? r.data : [];
      tableMount.innerHTML = '';
      UI.dataTable(tableMount, [
        { key: 'label', label: 'Jenis Dokumen' },
        { key: 'fileName', label: 'Template Saat Ini', render: row => row.fileUrl ? el('a', { href: row.fileUrl, target: '_blank' }, [row.fileName]) : el('span', { class: 'muted' }, ['— belum diatur —']) },
        { key: 'status', label: 'Status', type: 'badge' }
      ], rows, {
        actions: (row) => el('div', { class: 'flex gap-8' }, [
          el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openForm(row) }, ['Atur']),
          !row.fileId ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => buatBaru(row) }, ['+ Buat Baru']) : null
        ])
      });
    }
    function openForm(row) {
      const fields = [{ key: 'fileIdOrUrl', label: 'File ID atau Link Google Docs (kosongkan untuk menghapus pengaturan)', span2: true }];
      const form = UI.buildForm(fields, { fileIdOrUrl: row.fileId || '' });
      form.node.appendChild(el('div', { class: 'hint mt-8' }, ['Placeholder yang tersedia untuk ' + row.label + ': ' + row.placeholders.join(', ')]));
      const footBtn = el('button', {
        class: 'btn btn-primary', onclick: async () => {
          const v = form.getValues();
          const r = await api('templateDokumenSave', { jenis: row.jenis, fileIdOrUrl: v.fileIdOrUrl });
          UI.toast(r.message, r.success ? 'success' : 'error');
          if (r.success) { UI.closeModal(); load(true); }
        }
      }, ['Simpan']);
      UI.openModal('Atur Template — ' + row.label, form.node, footBtn);
    }
    async function buatBaru(row) {
      if (!UI.confirmDialog('Buat template baru otomatis untuk "' + row.label + '"? Dokumen baru berisi daftar placeholder siap pakai akan dibuat di folder Cetak — Anda bisa langsung mendesain ulang tata letak dan kopnya di Google Docs.')) return;
      const r = await api('templateDokumenBuatBaru', { jenis: row.jenis });
      UI.toast(r.message, r.success ? 'success' : 'error');
      if (r.success) { load(true); if (r.data && r.data.fileUrl) window.open(r.data.fileUrl, '_blank'); }
    }
    load();
  }

  // ------------------------------------------------------------------
  // Registrasi menu/route
  // ------------------------------------------------------------------
  window.PAGES = [
    { id: 'dashboard', label: 'Dashboard', modul: 'dashboard', render: renderDashboard },
    { id: 'aset', label: 'Aset (KIB A-F, Persediaan, QR)', modul: 'aset', render: renderAset },
    { id: 'transaksi', label: 'Transaksi & Berita Acara', modul: 'transaksi', render: renderTransaksi },
    { id: 'permintaan', label: 'Permintaan & Persetujuan', modul: 'permintaan', render: renderAlur, badgeKey: 'totalAntrean' },
    { id: 'pemeliharaan', label: 'Pemeliharaan & Tiket', modul: 'kerusakan', render: renderPemeliharaan },
    { id: 'keuangan', label: 'Keuangan & Rekonsiliasi', modul: 'dokumen_keuangan', render: renderKeuangan },
    { id: 'laporan', label: 'Laporan & Dokumen Kedinasan', modul: 'laporan', render: renderLaporan },
    { id: 'master', label: 'Master Data Pokok', modul: 'master_data', render: renderMaster },
    { id: 'pengguna', label: 'Pengguna & Log Audit', modul: 'log_aktivitas', altModul: 'pengguna', render: renderPenggunaLog },
    { id: 'pengaturan', label: 'Pengaturan Sistem', modul: 'pengaturan', render: renderPengaturan }
  ];
  window.PAGES_CAN = can;
})();
