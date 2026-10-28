/**
 * ui.js — Komponen UI generik: toast, modal, loading bar, render tabel (cari/filter/sort/
 * paginasi di sisi klien — US-18), render form dari skema, badge status, format angka/tanggal.
 */
(function () {
  let loadingCount = 0;
  function loadingStart() {
    loadingCount++;
    const bar = document.getElementById('loadingBar');
    if (bar) { bar.style.width = '70%'; }
  }
  function loadingDone() {
    loadingCount = Math.max(0, loadingCount - 1);
    const bar = document.getElementById('loadingBar');
    if (!bar) return;
    if (loadingCount === 0) { bar.style.width = '100%'; setTimeout(() => { bar.style.width = '0'; }, 250); }
  }

  function toast(message, type) {
    const wrap = document.getElementById('toastWrap');
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'err' : type === 'success' ? 'ok' : '');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function openModal(title, bodyNode, footNode) {
    document.getElementById('modalTitle').textContent = title;
    const body = document.getElementById('modalBody'); body.innerHTML = ''; body.appendChild(bodyNode);
    const foot = document.getElementById('modalFoot'); foot.innerHTML = ''; if (footNode) foot.appendChild(footNode);
    document.getElementById('modalOverlay').classList.add('show');
  }
  function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (attrs[k] === null || attrs[k] === undefined) return;
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(c => { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function rupiah(n) { n = Number(n) || 0; return 'Rp' + n.toLocaleString('id-ID'); }
  function tgl(v) {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function tglJam(v) {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const STATUS_BADGE = {
    'Baik': 'good', 'Disetujui': 'good', 'Sesuai': 'good', 'Aktif': 'good', 'Selesai': 'good',
    'Rusak Ringan': 'warn', 'Diproses': 'warn', 'Belum': 'warn', 'Ditangani': 'warn', 'Baru': 'info',
    'Rusak Berat': 'crit', 'Ditolak': 'crit', 'Tidak Sesuai': 'crit', 'Dihapus': 'crit',
    'Dipinjam': 'info', 'Tersedia': 'good', 'Nonaktif': 'muted'
  };
  function badge(text) {
    const cls = STATUS_BADGE[text] || 'muted';
    return el('span', { class: 'badge badge-' + cls }, [text == null || text === '' ? '-' : String(text)]);
  }
  function code(text) { return el('span', { class: 'code-badge' }, [String(text == null ? '-' : text)]); }

  /**
   * Tabel generik: kolom [{key,label,type:'text'|'num'|'rupiah'|'tanggal'|'badge'|'code',render}],
   * mendukung pencarian teks + sort kolom + paginasi lokal (US-18). `actions(row)` -> Node opsional.
   */
  function dataTable(container, columns, rows, opts) {
    opts = opts || {};
    const state = { q: '', sortKey: opts.defaultSort || null, sortDir: 1, page: 1, pageSize: opts.pageSize || 12 };
    container.innerHTML = '';
    const bar = el('div', { class: 'flex gap-8 items-center wrap mt-8 mb-0', style: 'margin-bottom:10px' }, [
      el('input', { placeholder: 'Cari...', style: 'max-width:240px', oninput: (e) => { state.q = e.target.value.toLowerCase(); state.page = 1; draw(); } })
    ]);
    const wrap = el('div', { class: 'table-wrap' });
    const pager = el('div', { class: 'flex items-center justify-between', style: 'padding:8px 10px;font-size:11px;color:var(--text-faint)' });
    container.appendChild(bar); container.appendChild(wrap); container.appendChild(pager);

    function filtered() {
      let r = rows;
      if (state.q) r = r.filter(row => columns.some(c => String(row[c.key] == null ? '' : row[c.key]).toLowerCase().indexOf(state.q) > -1));
      if (state.sortKey) {
        r = r.slice().sort((a, b) => {
          const av = a[state.sortKey], bv = b[state.sortKey];
          if (av == null) return 1; if (bv == null) return -1;
          return (av > bv ? 1 : av < bv ? -1 : 0) * state.sortDir;
        });
      }
      return r;
    }

    function draw() {
      const data = filtered();
      const totalPages = Math.max(1, Math.ceil(data.length / state.pageSize));
      state.page = Math.min(state.page, totalPages);
      const slice = data.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

      const table = el('table', {});
      const thead = el('thead', {}, [el('tr', {}, columns.map(c =>
        el('th', { class: c.type === 'num' || c.type === 'rupiah' ? 'num' : '', onclick: () => { state.sortKey = c.key; state.sortDir = (state.sortKey === c.key ? -state.sortDir : 1); draw(); }, style: 'cursor:pointer' }, [c.label])
      ).concat(opts.actions ? [el('th', {}, ['Aksi'])] : []))]);
      const tbody = el('tbody', {});
      if (!slice.length) {
        tbody.appendChild(el('tr', { class: 'empty-row' }, [el('td', { colspan: String(columns.length + (opts.actions ? 1 : 0)) }, ['Belum ada data.'])]));
      }
      slice.forEach(row => {
        const tr = el('tr', {});
        columns.forEach(c => {
          let content;
          if (c.render) content = c.render(row);
          else if (c.type === 'rupiah') content = rupiah(row[c.key]);
          else if (c.type === 'tanggal') content = tgl(row[c.key]);
          else if (c.type === 'badge') content = badge(row[c.key]);
          else if (c.type === 'code') content = code(row[c.key]);
          else content = row[c.key] == null ? '-' : String(row[c.key]);
          const td = el('td', { class: c.type === 'num' || c.type === 'rupiah' ? 'num' : '' }, [content instanceof Node ? content : content]);
          tr.appendChild(td);
        });
        if (opts.actions) tr.appendChild(el('td', {}, [opts.actions(row)]));
        tbody.appendChild(tr);
      });
      table.appendChild(thead); table.appendChild(tbody);
      wrap.innerHTML = ''; wrap.appendChild(table);
      pager.innerHTML = '';
      pager.appendChild(el('span', {}, [data.length + ' baris']));
      pager.appendChild(el('div', { class: 'flex gap-8' }, [
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => { if (state.page > 1) { state.page--; draw(); } } }, ['‹']),
        el('span', { style: 'align-self:center' }, ['Hal ' + state.page + '/' + totalPages]),
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => { if (state.page < totalPages) { state.page++; draw(); } } }, ['›'])
      ]));
    }
    draw();
    return { refresh: (newRows) => { rows = newRows; draw(); } };
  }

  /** Form generik dari skema [{key,label,type:'text'|'number'|'date'|'select'|'textarea',required,options}] */
  function buildForm(fields, values) {
    values = values || {};
    const form = el('div', { class: 'form-grid' });
    const inputs = {};
    fields.forEach(f => {
      const wrap = el('div', { class: 'field' + (f.span2 ? ' span-2' : '') });
      wrap.appendChild(el('label', {}, [f.label + (f.required ? ' *' : '')]));
      let input;
      if (f.type === 'select') {
        input = el('select', {}, (f.options || []).map(o => el('option', { value: o.value }, [o.label])));
        input.value = values[f.key] != null ? values[f.key] : (f.options && f.options[0] ? f.options[0].value : '');
      } else if (f.type === 'textarea') {
        input = el('textarea', {});
        input.value = values[f.key] || '';
      } else {
        input = el('input', { type: f.type || 'text' });
        if (f.type === 'number') input.step = f.step || 'any';
        input.value = values[f.key] != null ? values[f.key] : '';
      }
      input.dataset.key = f.key;
      wrap.appendChild(input);
      if (f.hint) wrap.appendChild(el('div', { class: 'hint' }, [f.hint]));
      inputs[f.key] = input;
      form.appendChild(wrap);
    });
    return {
      node: form,
      getValues: () => { const o = {}; fields.forEach(f => { o[f.key] = inputs[f.key].value; }); return o; },
      setError: (key) => { if (inputs[key]) inputs[key].style.borderColor = 'var(--crit-border)'; }
    };
  }

  function confirmDialog(message) { return window.confirm(message); }

  window.UI = { el, toast, openModal, closeModal, dataTable, buildForm, badge, code, rupiah, tgl, tglJam, loadingStart, loadingDone, confirmDialog };
})();
