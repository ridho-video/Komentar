# 🎬 TikTok Live Overlay Lite

Overlay **komentar, gift, like, dan jumlah penonton TikTok LIVE** yang dibuat sangat ringan untuk laptop spek rendah (CPU lemah, RAM kecil, masih pakai HDD).

Tampilannya transparan, selalu di atas aplikasi lain, dan bisa dipakai di atas game, OBS, atau browser. Tidak perlu login atau password TikTok.

> Terinspirasi dari [rizkif-com/Tiktok-Live-Chat-Overlay](https://github.com/rizkif-com/Tiktok-Live-Chat-Overlay). Kode di sini ditulis ulang dengan fokus hemat resource. Proyek ini tidak berafiliasi dengan TikTok atau ByteDance.

---

## ✨ Fitur

- 💬 Komentar LIVE real-time (yang terbaru selalu di bawah)
- 👁️ Jumlah penonton saat ini
- 🏆 Top viewers (peringkat dari TikTok)
- ❤️ Total like
- 🎁 Notifikasi gift lengkap dengan combo (oranye = combo masih berjalan, merah = selesai)
- 💎 Total diamond dari gift yang masuk
- ➕ Notifikasi follow dan 🔗 share LIVE
- 👋 Ticker "siapa yang baru bergabung" (tidak memenuhi daftar komentar)
- 📌 Selalu di atas aplikasi lain · 🪟 transparansi bisa diatur · 🖱️ mode klik-tembus
- 📐 Ukuran Kecil / Sedang / Besar, atau tarik pojok kanan bawah
- 🔄 Sambung ulang otomatis kalau koneksi putus atau akun belum LIVE
- 🧪 **Mode demo** untuk mencoba tampilan tanpa harus LIVE

## 🪶 Kenapa ringan?

| Teknik | Efek |
| --- | --- |
| Library TikTok baru dimuat saat klik **Hubungkan** | Aplikasi terbuka lebih cepat di HDD |
| Semua event dikumpulkan lalu dikirim sekali tiap ±0,35 detik | CPU hampir 0% saat LIVE sepi |
| Event "bergabung" dan "like" digabung | Tidak ada update layar ribuan kali |
| Maksimal 35 baris komentar di layar (bisa diubah) | Memori stabil, tidak membengkak |
| Tanpa gambar/avatar, tanpa animasi, tanpa blur, tanpa web font | Hemat CPU dan GPU |
| GPU dimatikan secara default + proses GPU digabung ke proses utama | Lebih sedikit proses dan memori |
| Prioritas proses rendah | Aplikasi lain (TikTok LIVE Studio, OBS, game) tetap lancar |

Catatan jujur: aplikasi ini memakai Electron (sama seperti referensinya), jadi tetap memakai beberapa ratus MB RAM seperti aplikasi berbasis Chromium lain. Semua pengaturan di atas dibuat untuk menekannya serendah mungkin.

---

## 🚀 Cara mendapatkan file EXE (tanpa install apa pun di laptop)

EXE dibuat otomatis oleh GitHub, jadi laptop kamu tidak perlu menginstal Node.js atau apa pun.

1. **Buat akun & repository** di [github.com](https://github.com). Klik **New repository**, beri nama `tiktok-live-overlay-lite`, lalu **Create repository**.
2. **Upload file.** Ekstrak ZIP proyek ini, lalu di halaman repository klik **uploading an existing file** dan seret **isi folder** (`src`, `build`, `.github`, `package.json`, `package-lock.json`, dst.) ke halaman tersebut, lalu klik **Commit changes**.
   - Jangan hapus `package-lock.json`, file itu dipakai saat build.
   - Kalau folder `.github` tidak ikut terupload (kadang tersembunyi), klik **Add file → Create new file**, ketik nama `.github/workflows/build.yml`, lalu tempel isi file `build.yml` dari ZIP.
3. **Jalankan build.** Buka tab **Actions**. Jika muncul tombol untuk mengaktifkan workflow, klik. Pilih **Build EXE (Windows)** → **Run workflow**.
4. **Tunggu ±5–10 menit** sampai ada tanda centang hijau ✅.
5. **Unduh.** Klik run yang selesai, lalu di bagian **Artifacts** unduh `TikTok-Live-Overlay-Lite-Windows`. Ekstrak ZIP-nya, di dalamnya ada file EXE.

> Repository publik memakai GitHub Actions gratis. Repository privat memakai jatah menit gratis bulanan.

**Mau EXE muncul rapi di halaman Releases?** Buka **Releases → Draft a new release**, isi tag `v1.0.0`, lalu **Publish release**. Build berjalan otomatis dan EXE terlampir di release itu.

### Pilih file yang mana?

| File | Untuk apa |
| --- | --- |
| `...-Setup-1.0.0-x64.exe` | **Rekomendasi.** Windows 10/11 64-bit. Terpasang sekali, lalu buka berikutnya cepat. |
| `...-Setup-1.0.0-ia32.exe` | Hanya jika Windows kamu 32-bit (cek: Settings → System → About → System type). |
| `...-Portable-1.0.0-x64.exe` | Tanpa instalasi, tapi **lebih lambat di HDD** karena mengekstrak file setiap dibuka. |

Windows mungkin menampilkan peringatan **"Windows protected your PC"** karena EXE belum ditandatangani sertifikat berbayar. Klik **More info → Run anyway**. Kamu bisa memeriksa seluruh kode di repository ini.

### Persyaratan

- **Windows 10 atau Windows 11.** Windows 7/8/8.1 tidak didukung oleh Electron versi modern.
- Koneksi internet.

---

## 🎮 Cara pakai

1. Buka aplikasi.
2. Ketik username host (contoh `namaakun`) atau tempel link `https://www.tiktok.com/@namaakun/live`.
3. Klik **Hubungkan**. Akun tujuan harus sedang LIVE dan publik.
4. Tarik bilah judul untuk memindahkan. Klik ⚙ untuk pengaturan.

Mau coba tampilan dulu? Klik ⚙ → **Mode demo**.

| Kontrol | Fungsi |
| --- | --- |
| Tarik bilah judul | Pindahkan overlay |
| Tarik pojok kanan bawah | Ubah ukuran |
| 📌 | Selalu di atas aplikasi lain |
| 🖱 | Klik-tembus (klik menembus overlay ke aplikasi di belakangnya) |
| `Ctrl` + `Shift` + `X` | Nyalakan/matikan klik-tembus dari aplikasi mana pun |
| `Ctrl` + `Shift` + `H` | Sembunyikan/tampilkan overlay |

> Kalau overlay tidak bisa diklik, mode klik-tembus sedang aktif. Tekan **Ctrl + Shift + X**. Mode ini selalu mati lagi saat aplikasi dibuka ulang.

## 🐢 Tips untuk laptop kentang / HDD

- Pakai versi **Setup**, bukan Portable.
- Kecilkan **Maks. baris komentar** di Pengaturan (misalnya 20).
- Biarkan **Pakai GPU** dalam keadaan mati (default). Nyalakan hanya kalau overlay terasa patah-patah.
- Biarkan **Prioritas rendah** menyala supaya aplikasi lain didahulukan.
- Matikan "Tampilkan bergabung" kalau LIVE sangat ramai.
- Buka pertama kali setelah komputer menyala bisa lebih lama di HDD. Pembukaan berikutnya lebih cepat.

## ❓ Pemecahan masalah

**"Gagal membaca data LIVE"** — pastikan akun sedang LIVE, username benar, dan internet aktif. Aplikasi akan mencoba lagi otomatis.

**"Terkena batas permintaan server signing"** — library TikTok yang dipakai meneruskan proses koneksi lewat layanan pihak ketiga ([Euler Stream](https://www.eulerstream.com)). Tunggu sebentar, atau buat API key di sana dan isi di ⚙ → *API key Euler Stream*.

**Komentar tidak muncul** — tunggu beberapa detik setelah status hijau. Kalau tetap kosong, klik **Putus** lalu **Hubungkan** lagi.

**Penonton atau like masih `—`** — angka muncul saat TikTok mengirim datanya, bisa butuh beberapa detik. Pada LIVE yang sangat ramai, TikTok tidak selalu mengirim event like.

**Build di Actions gagal** — buka run yang gagal dan baca baris merahnya. Penyebab paling umum: `package-lock.json` atau folder `build` tidak ikut terupload.

---

## 🛠️ Untuk developer (opsional)

Butuh Node.js 22 atau lebih baru.

```bash
npm install
npm start        # jalankan
npm run demo     # jalankan dengan data demo
npm run dist     # bangun EXE Windows ke folder dist/
```

### Struktur proyek

```
tiktok-live-overlay-lite/
├── .github/workflows/build.yml   # build EXE otomatis di GitHub
├── build/icon.ico                # ikon aplikasi
├── src/
│   ├── main.js        # jendela Electron + koneksi TikTok LIVE + batching event
│   ├── preload.cjs    # jembatan IPC yang aman
│   ├── renderer.js    # logika tampilan overlay
│   ├── index.html     # struktur tampilan
│   └── styles.css     # gaya (sengaja sederhana)
├── package.json
└── package-lock.json
```

Pengaturan tersimpan di `%APPDATA%\TikTok Live Overlay Lite\settings.json`.

## ⚠️ Disclaimer

Proyek ini memakai [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector), library tidak resmi yang membaca event TikTok LIVE publik. Karena itu:

- aplikasi bisa berhenti bekerja kapan saja jika TikTok mengubah sistemnya;
- proses koneksi diteruskan lewat server signing pihak ketiga (Euler Stream);
- hanya gunakan untuk LIVE yang dapat diakses publik, dan patuhi ketentuan platform yang berlaku.

## 📄 Lisensi

[MIT](LICENSE)
