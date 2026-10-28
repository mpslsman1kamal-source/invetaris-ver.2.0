# Panduan Instalasi — Aplikasi Inventaris Barang SMAN 1 Kamal Bangkalan

Aplikasi ini terdiri dari **2 bagian terpisah** yang harus dipasang berurutan:

1. **Backend** — Google Apps Script (database di Google Sheets, REST API)
2. **Frontend** — halaman web statis (folder ini) yang di-deploy ke GitHub Pages

Backend harus beres dulu (sampai punya URL `/exec`) sebelum frontend bisa dipakai.

---

## BAGIAN A — Setup Backend (Google Apps Script)

### A1. Buat proyek Apps Script

1. Buka `https://script.new` (otomatis membuat proyek Apps Script baru di akun Google Anda).
2. Beri nama proyek, misalnya **"Inventaris Barang SMAN 1 Kamal — Backend"**.
3. Hapus isi file `Code.gs` bawaan (kosongkan).

### A2. Salin 16 file backend

Anda menerima 16 file `.gs` + 1 `appsscript.json` secara terpisah (folder `backend-gas/`). Untuk tiap file `.gs`:

1. Di editor Apps Script, klik ikon **+** di sebelah "Files" → **Script**.
2. Beri nama file **persis sama** (tanpa `.gs`, Apps Script menambahkannya otomatis), misal `Kode`, `Config`, `Auth`, `Util`, `Setup`, `DocEngine`, `Modules_Dashboard`, `Modules_Master`, `Modules_Aset`, `Modules_Persediaan`, `Modules_Transaksi`, `Modules_Alur`, `Modules_Pemeliharaan`, `Modules_Keuangan`, `Modules_Laporan`, `Modules_Pengaturan`.
3. Tempel isi file `.gs` yang sesuai ke dalamnya.

Untuk `appsscript.json` (konfigurasi proyek, bukan kode): klik ikon gerigi **Project Settings** → centang **"Show appsscript.json manifest file in editor"** → file itu akan muncul di daftar Files → buka dan timpa isinya dengan isi `appsscript.json` yang Anda terima.

> 💡 Urutan file tidak penting — Apps Script tidak peduli urutan, semua fungsi saling bisa memanggil.

### A3. Jalankan setup database otomatis

1. Buka file `Setup.gs` di editor.
2. Ganti baris `SUPER_ADMIN_EMAIL` dengan **akun Google Anda sendiri** (akun yang akan jadi Super Admin pertama).
3. Di toolbar atas, pilih fungsi **`setupAppEnvironment`** dari dropdown, lalu klik **Run (▶)**.
4. Saat diminta izin, klik **Review permissions** → pilih akun Anda → **Advanced** → **Go to (nama proyek) (unsafe)** → **Allow**. (Peringatan "unsafe" muncul karena proyek belum diverifikasi Google — normal untuk proyek pribadi/internal sekolah.)
5. Buka tab **Executions** atau **View → Logs** untuk melihat hasil: akan muncul `SPREADSHEET_ID`, URL Spreadsheet, dan URL folder Drive. Simpan URL ini — di situlah database dan file Anda tersimpan.

**Jangan jalankan `setupAppEnvironment` dua kali** (akan membuat Spreadsheet & folder duplikat). Kalau perlu mengulang, hapus dulu Spreadsheet dan folder yang lama secara manual di Drive.

### A4. Buat OAuth Client ID (untuk login Google)

1. Buka `https://console.cloud.google.com/`.
2. Buat project baru (atau pakai yang sudah ada) — nama bebas, misalnya "Inventaris SMAN 1 Kamal".
3. Menu **APIs & Services → OAuth consent screen**: pilih **Internal** (kalau akun sekolah pakai Google Workspace) atau **External** (kalau pakai Gmail biasa) → isi nama aplikasi, email dukungan, lalu simpan (untuk tipe External, status "Testing" sudah cukup selama hanya 4 akun yang dipakai — tambahkan keempat email pengguna di **Test users**).
4. Menu **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
5. Application type: **Web application**. Nama bebas.
6. **Authorized JavaScript origins** — tambahkan dua ini (isi nanti setelah tahu URL GitHub Pages-nya, lihat Bagian C):
   - `https://USERNAME.github.io` (ganti USERNAME dengan username GitHub Anda)
   - `http://localhost:5500` (opsional, untuk uji coba lokal)
7. Klik **Create**. Salin **Client ID** yang muncul (format `xxxxxxxx.apps.googleusercontent.com`).

### A5. Isi Script Properties

Di editor Apps Script: ikon gerigi **Project Settings** → scroll ke **Script Properties** → **Add script property**, tambahkan:

| Property | Nilai |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID dari langkah A4 |

(Property lain seperti `SPREADSHEET_ID`, `ROOT_FOLDER_ID`, folder-folder Drive sudah terisi otomatis oleh `setupAppEnvironment()` di langkah A3 — jangan diubah manual.)

### A6. Deploy sebagai Web App (REST API)

1. Klik tombol biru **Deploy → New deployment**.
2. Klik ikon gerigi di samping "Select type" → pilih **Web app**.
3. Isi:
   - **Description**: bebas, misal "v1"
   - **Execute as**: **Me** (akun Anda)
   - **Who has access**: **Anyone** (akses sesungguhnya tetap dibatasi di dalam kode lewat sheet `USERS` — lihat `Auth.gs`)
4. Klik **Deploy**. Salin **Web app URL** yang muncul (diakhiri `/exec`). Ini nilai `GAS_URL` untuk frontend.

> Kalau nanti Anda mengubah kode backend, ulangi dari **Deploy → Manage deployments → ikon pensil → New version → Deploy** supaya perubahan ikut terpasang (URL `/exec` tetap sama).

### A7. Siapkan template dokumen cetak (untuk fitur Laporan/Cetak PDF)

Modul cetak (KIB, KIR, Buku Inventaris, Mutasi, Penyusutan, Berita Acara, Label QR) butuh **template Google Docs** berisi placeholder teks `{{SEPERTI_INI}}`, yang akan diisi otomatis lalu diekspor jadi PDF.

**Sejak versi ini, template diatur lewat aplikasi sendiri** — login sebagai Super Admin → menu **Pengaturan Sistem → tab "Template Dokumen"**. Di sana, untuk tiap jenis dokumen Anda bisa:

- Klik **"+ Buat Baru"** supaya aplikasi otomatis membuatkan Google Docs baru (di folder Cetak) berisi daftar placeholder `{{...}}` yang sudah benar — tinggal buka linknya dan desain ulang tata letak/kop surat/logo sesuka Anda, asal teks placeholder-nya tidak dihapus (boleh dipindah ke mana saja, termasuk ke dalam sel tabel).
- Atau klik **"Atur"** lalu tempel **File ID atau link lengkap** Google Docs yang sudah Anda buat/desain sendiri.

Daftar placeholder per jenis dokumen (juga ditampilkan di halaman "Atur" masing-masing):

| Jenis | Placeholder yang tersedia |
|---|---|
| KIB | `{{NAMA_INSTANSI}}` `{{ALAMAT_INSTANSI}}` `{{KEPALA_SEKOLAH}}` `{{TAHUN_AJARAN}}` `{{TANGGAL_CETAK}}` `{{JENIS_KIB}}` `{{JUMLAH_ITEM}}` `{{TOTAL_NILAI}}` `{{DAFTAR}}` |
| KIR | kop (sama seperti di atas) + `{{NAMA_RUANGAN}}` `{{PENANGGUNG_JAWAB}}` `{{JUMLAH_ITEM}}` `{{DAFTAR}}` |
| Buku Inventaris | kop + `{{JUMLAH_ITEM}}` `{{DAFTAR}}` |
| Laporan Mutasi | kop + `{{PERIODE}}` `{{JUMLAH_ITEM}}` `{{DAFTAR}}` |
| Laporan Penyusutan | kop + `{{JUMLAH_ITEM}}` `{{TOTAL_NILAI_BUKU}}` `{{DAFTAR}}` |
| Berita Acara | kop + `{{NOMOR_BA}}` `{{JENIS_BA}}` `{{TANGGAL}}` `{{PIHAK_1}}` `{{PIHAK_2}}` `{{RINGKASAN}}` |
| Label QR Aset | `{{KODE_ASET}}` `{{NAMA_ASET}}` `{{KODE_QR}}` `{{NAMA_INSTANSI}}` dan **`{{QR_IMAGE}}`** (taruh di sel/baris kosong — akan diganti gambar QR code) |

> `{{DAFTAR}}` adalah daftar baris data (tabel) yang digabung jadi satu blok teks bertab — taruh placeholder ini **di dalam satu sel tabel** pada template Docs Anda supaya rapi saat dicetak.

Cara lama (mengisi Script Property `TEMPLATE_MAP` manual di editor Apps Script) masih tetap berfungsi sebagai cadangan — keduanya membaca/menulis properti yang sama, jadi template yang pernah Anda atur manual akan langsung terlihat di menu "Template Dokumen" ini.

### A8. Tambah pengguna lain

Setelah login pertama sebagai Super Admin, buka menu **Pengguna & Log** di aplikasi untuk menambahkan 3 akun Google lain (Staf Inventaris, Bendahara, Kepala Sekolah) — tidak perlu edit Sheets manual.

---

## BAGIAN B — Isi Konfigurasi Frontend

Sebelum di-deploy, buka file `js/config.js` di folder frontend ini, dan isi dua nilai:

```js
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/ISI_DENGAN_URL_DARI_LANGKAH_A6/exec',
  GOOGLE_CLIENT_ID: 'ISI_DENGAN_CLIENT_ID_DARI_LANGKAH_A4.apps.googleusercontent.com',
  ...
};
```

Simpan file.

---

## BAGIAN C — Deploy Frontend ke GitHub Pages

Folder **ini** (tempat `index.html` berada) adalah folder yang akan diunggah ke GitHub — **jangan** masuk atau naik folder lagi sebelum menjalankan `git init`.

Ringkasan langkah (detail interaktif, termasuk cara mengatasi error, bisa diminta ke Claude kapan saja — sebutkan Anda sedang ikuti "panduan deploy GitHub Pages"):

1. **Install Git** (jika belum) dan buat akun di `https://github.com`.
2. **Setup identitas Git** (sekali saja per komputer):
   ```bash
   git config --global user.name "Nama Anda"
   git config --global user.email "email@akun-github-anda.com"
   ```
3. **Buat repository baru** di github.com (tombol **+ → New repository**), pilih **Public**, **jangan** centang README/.gitignore.
4. **Verifikasi Anda ada di folder yang benar**: jalankan `dir` (Windows) atau `ls` (Mac/Linux) — harus terlihat `index.html` di baris paling atas, bukan folder `frontend` atau `backend-gas`.
5. **Inisialisasi & push**, dari folder ini, satu per satu:
   ```bash
   git init
   git add .
   git commit -m "Upload pertama"
   git branch -M main
   git remote add origin https://github.com/USERNAME/NAMA-REPO.git
   git push -u origin main
   ```
   (Saat diminta password, gunakan **Personal Access Token** dari `https://github.com/settings/tokens`, bukan password akun biasa — centang scope **repo**.)
6. **Aktifkan GitHub Pages**: di repo → **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main / (root)**, centang **Enforce HTTPS** → **Save**. Tunggu 1-2 menit, situs akan tersedia di `https://USERNAME.github.io/NAMA-REPO/`.
7. **Lengkapi Authorized JavaScript origins** di Google Cloud Console (langkah A4) dengan URL GitHub Pages ini kalau belum.
8. Buka situsnya, login dengan akun Google yang sudah didaftarkan di sheet `USERS`.

**Update berikutnya** cukup:
```bash
git add .
git commit -m "Deskripsi perubahan"
git push
```

---

## Troubleshooting Cepat

| Gejala | Kemungkinan Penyebab | Solusi |
|---|---|---|
| Login gagal "Akun belum terdaftar" | Email belum ada di sheet `USERS` atau status bukan "Aktif" | Tambahkan lewat Super Admin → menu Pengguna, atau edit sheet langsung untuk Super Admin pertama |
| Tombol Google Sign-In tidak muncul | `GOOGLE_CLIENT_ID` di `config.js` salah/kosong, atau origin belum ditambahkan di Cloud Console | Cek ulang Bagian A4 & B |
| Situs tampil tapi semua data gagal dimuat | `GAS_URL` di `config.js` salah, atau deployment backend belum di-redeploy setelah ubah kode | Cek ulang Bagian A6 & B |
| Error "Template dokumen belum diatur" saat cetak | `TEMPLATE_MAP` belum diisi/ID salah | Lihat Bagian A7 |
| CSS/JS tidak termuat (halaman polos) di GitHub Pages | Struktur folder rusak saat push (file rata di root tanpa `css/`/`js/`) | Minta bantuan Claude dengan menyebut "CSS/JS 404 di GitHub Pages" |
| Halaman 404 di GitHub Pages | `git init` dijalankan di folder yang salah | Minta bantuan Claude dengan menyebut "folder salah yang di-push GitHub Pages" |

Untuk bantuan interaktif langkah-demi-langkah (termasuk kirim screenshot terminal untuk dicek), tanyakan ke Claude kapan saja.
