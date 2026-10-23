# ZCode Gateway

[Bahasa Indonesia](README.md) | [English](README.en.md)

Pakai model dari akun ZCode Anda di OmniRoute atau aplikasi yang mendukung API OpenAI dan Anthropic. Anda bisa menambahkan beberapa akun, melihat sisa kuota, dan memilih paket untuk tiap akun.

Sudah diuji dengan ZCode **3.16.3**, **GLM-5.3**, dan **GLM-5.3-Flash**. Proyek ini dibuat secara independen. Jika ZCode mengubah layanannya, integrasi ini mungkin perlu diperbarui.

## Mulai dari sini

Siapkan Node.js **24.14 atau lebih baru** dan aplikasi ZCode yang sudah terpasang. Jalankan perintah berikut dari folder proyek.

### 1. Unduh proyek

```sh
git clone https://github.com/revanapriyandi/zcode-gateway.git
cd zcode-gateway
```

### 2. Buat pengaturan awal

```sh
node src/cli.ts init
```

Perintah ini membuat file `.env` dan folder `data`. Cukup jalankan sekali saat pertama memasang.

Buka `.env`. Ada dua pengaturan yang perlu Anda kenali:

| Nama di `.env` | Dipakai untuk apa? |
|---|---|
| `ZCODE_API_KEYS` | Isi kolom **API Key** di OmniRoute atau aplikasi yang akan terhubung ke ZCode Gateway. |
| `ZCODE_MASTER_KEY` | Membuka data akun yang tersimpan. Jangan diganti selama masih memakai data akun tersebut. |

**Untuk mengisi API Key, salin nilai setelah `ZCODE_API_KEYS=`.** Jangan ikut menyalin nama pengaturan atau tanda `=`. Jika ada beberapa nilai yang dipisahkan koma, pilih salah satu.

Nilainya dibuat otomatis oleh `init`; Anda tidak perlu mencarinya di situs ZCode. Simpan `.env` dan folder `data` sebagai pasangan saat membuat cadangan atau pindah komputer.

### 3. Siapkan file dari aplikasi ZCode

Untuk instalasi Windows di lokasi berikut:

```sh
node --env-file=.env src/cli.ts provision "C:/Program Files/ZCode/resources/glm/zcode.cjs"
```

Ganti lokasi file jika ZCode Anda terpasang di folder lain. Untuk sistem lain, gunakan lokasi `resources/glm/zcode.cjs` dari instalasi ZCode Anda.

Perintah ini membuat `data/template.json` dari aplikasi ZCode yang terpasang. File ini diperlukan agar request bisa dikirim ke ZCode. Instalasi ZCode Anda tetap seperti semula.

### 4. Tambahkan akun

Pilih salah satu cara berikut.

**Pakai akun yang sudah login di aplikasi ZCode pada komputer ini:**

```sh
node --env-file=.env src/cli.ts import-desktop "Akun pertama"
```

**Atau login lewat browser:**

```sh
node --env-file=.env src/cli.ts login zai "Akun pertama"
```

Browser akan terbuka otomatis. Pilih akun dan setujui login, lalu tunggu sampai terminal menampilkan hasilnya. Biarkan terminal tetap berjalan selama Anda menyelesaikan login.

Jika browser tidak terbuka, salin URL lengkap yang muncul di terminal. Tautan pendek **Open ZCode login** juga bisa dipakai pada terminal yang mendukungnya; Git Bash mungkin memerlukan Ctrl+klik.

`"Akun pertama"` hanya nama penanda. Anda bebas menggantinya agar mudah mengenali akun.

### 5. Jalankan ZCode Gateway

```sh
node --env-file=.env src/cli.ts serve
```

Biarkan terminal ini berjalan. Alamat API bawaan adalah `http://127.0.0.1:8080/v1`.

## Hubungkan ke OmniRoute

Di OmniRoute, tambahkan provider **OpenAI-compatible / Chat Completions**, lalu isi:

| Kolom di OmniRoute | Isinya |
|---|---|
| Base URL | Alamat ZCode Gateway yang bisa dijangkau OmniRoute, diakhiri `/v1`. |
| API Key | Satu nilai dari `ZCODE_API_KEYS` di `.env` tempat ZCode Gateway itu berjalan. |
| Model | `glm-5.3-flash` dan `glm-5.3`, sesuai model yang tersedia pada akun. |

Setelah disimpan, impor model dari `/v1/models`.

Alamat yang dipakai bergantung pada tempat Anda menjalankannya:

| Tempat menjalankan | Contoh Base URL |
|---|---|
| Keduanya berjalan langsung di komputer yang sama | `http://127.0.0.1:8080/v1` |
| Keduanya berada di jaringan Docker yang sama | `http://zcode-gateway:8080/v1` |
| Berbeda komputer atau server | Alamat server ZCode Gateway yang bisa diakses OmniRoute. |

`127.0.0.1` menunjuk ke tempat aplikasi itu sendiri berjalan. Jika OmniRoute ada di VPS dan ZCode Gateway ada di laptop, `127.0.0.1` pada VPS tidak mengarah ke laptop. Jika OmniRoute memakai Docker, pilih alamat yang bisa dijangkau dari container tersebut.

**Jika ZCode Gateway berjalan di VPS, ambil `ZCODE_API_KEYS` dari `.env` di VPS itu.** Nilainya bisa berbeda dari `.env` laptop.

Jika prefix provider di OmniRoute adalah `zcg`, aplikasi yang mengakses melalui OmniRoute memakai model `zcg/glm-5.3-flash` atau `zcg/glm-5.3`. Aplikasi tersebut memakai API key yang dibuat di OmniRoute. Nilai `ZCODE_API_KEYS` dipakai pada koneksi dari OmniRoute ke ZCode Gateway.

Kuota juga bisa ditampilkan di OmniRoute. Contoh pengaturannya ada di [panduan kuota OmniRoute](README.en.md#choose-a-package-or-subscription). Total kuota berasal dari akun aktif. Tanggal berakhir kuota mengikuti paket ZCode; jangan menganggapnya sebagai waktu reset harian.

## Tambah akun dan cek kuota

Hentikan `serve` dengan **Ctrl+C** sebelum mengelola akun. Jalankan login lagi dan pilih akun berbeda:

```sh
node --env-file=.env src/cli.ts login zai "Akun kedua"
```

Anda juga bisa mengganti akun di aplikasi ZCode, lalu menjalankan `import-desktop` lagi. Jika akun itu sudah tersimpan, datanya diperbarui tanpa menambah duplikat.

| Keperluan | Perintah |
|---|---|
| Lihat akun dan ID-nya | `node --env-file=.env src/cli.ts accounts` |
| Perbarui sisa kuota | `node --env-file=.env src/cli.ts quota` |
| Lihat paket | `node --env-file=.env src/cli.ts plans` |
| Nonaktifkan akun | `node --env-file=.env src/cli.ts disable ACCOUNT_ID` |
| Aktifkan lagi | `node --env-file=.env src/cli.ts enable ACCOUNT_ID` |
| Hapus akun dari ZCode Gateway | `node --env-file=.env src/cli.ts remove ACCOUNT_ID` |

Ganti `ACCOUNT_ID` dengan ID dari perintah `accounts`. Menghapus akun di sini tidak mengeluarkan akun dari aplikasi ZCode. Setelah selesai, jalankan `serve` lagi.

Request dibagi bergiliran ke akun aktif yang mendukung model tersebut. Setiap akun menangani satu request pada satu waktu. Jika satu akun gagal sebelum jawaban mulai dikirim, ZCode Gateway dapat mencoba akun lain.

## Ganti paket yang dipakai

Setiap akun awalnya memakai `start-plan`. Paket, model, dan sisa kuota mengikuti informasi dari akun ZCode Anda. Paket baru pada layanan yang sama akan terbaca saat kuota diperbarui.

Untuk memakai Start Plan:

```sh
node --env-file=.env src/cli.ts plan ACCOUNT_ID start-plan
```

Jika punya langganan Coding Plan, simpan API key langganan itu dalam file pribadi, lalu jalankan:

```sh
node --env-file=.env src/cli.ts plan ACCOUNT_ID coding-plan --key-file "/lokasi/file-api-key-langganan" --models glm-5.3,glm-5.3-flash
```

Ganti lokasi file dan daftar model sesuai langganan Anda. API key Coding Plan berasal dari langganan Z.ai. `ZCODE_API_KEYS` tetap dipakai untuk aplikasi yang terhubung ke ZCode Gateway.

Perubahan berlaku untuk akun yang dipilih saja. Coding Plan sudah diuji dengan data tiruan; pemakaian akun berbayar sungguhan belum diverifikasi. Lihat [pengaturan langganan dari Z.ai](https://docs.z.ai/devpack/tool/claude).

## Hubungkan langsung ke aplikasi lain

Untuk aplikasi yang mendukung API OpenAI, isi Base URL `http://127.0.0.1:8080/v1`, API Key dari `ZCODE_API_KEYS`, dan model `glm-5.3-flash` atau `glm-5.3`.

Contoh uji lewat Bash / Git Bash. Ganti teks dalam tanda petik dengan satu nilai `ZCODE_API_KEYS` dari `.env`:

```sh
export ZCODE_API_KEYS='salin_satu_nilai_dari_env_anda'

curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer $ZCODE_API_KEYS" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"Halo"}],"reasoning_effort":"low","stream":true}'
```

`export` mengisi nilai untuk terminal tersebut tanpa mengubah `.env`. Jika `ZCODE_API_KEYS` sudah diatur di terminal, nilai terminal itu juga akan dipakai saat menjalankan CLI.

Untuk Claude Code atau aplikasi dengan API Anthropic, gunakan nilai yang sama di Bash / Git Bash:

```sh
export ANTHROPIC_BASE_URL=http://127.0.0.1:8080
export ANTHROPIC_AUTH_TOKEN="$ZCODE_API_KEYS"
export ANTHROPIC_MODEL=glm-5.3-flash
```

## Model dan fitur

| Fitur | GLM-5.3-Flash | GLM-5.3 |
|---|---|---|
| Percakapan teks | Ya | Ya |
| Input gambar | Ya, dalam base64 | Tidak |
| Jawaban muncul bertahap / streaming | Ya | Ya |
| Pemanggilan tool | Ya | Ya |
| Effort | `low`, `high`, `max` | `low`, `high`, `max` |

Untuk effort, gunakan `reasoning_effort` pada Chat Completions, `reasoning.effort` pada Responses, atau `output_config.effort` pada Messages. `minimal` dipetakan ke `low`, `medium` ke `high`, dan `xhigh` ke `max`. Permintaan untuk mematikan thinking akan ditolak.

ZCode Gateway mengirim permintaan tool ke aplikasi Anda. Aplikasi Anda yang menjalankan tool dan mengembalikan hasilnya. Web search dan code interpreter bawaan OpenAI belum disediakan. Memakai format API OpenAI atau Anthropic tetap menjalankan model GLM dari akun ZCode Anda.

| Alamat API | Kegunaan |
|---|---|
| `POST /v1/chat/completions` | Format OpenAI Chat Completions |
| `POST /v1/responses` | Format OpenAI Responses |
| `POST /v1/messages` | Format Anthropic Messages |
| `GET /v1/models` | Daftar model dan kemampuannya |
| `GET /api/usage` | Sisa kuota; diperbarui paling sering tiap 60 detik |
| `GET /api/plans` | Paket pada akun |
| `GET /health` | Cek apakah layanan berjalan |

Semua alamat tersebut memerlukan API key dari `ZCODE_API_KEYS`. Ketiga format percakapan mendukung jawaban biasa, streaming, dan pemanggilan tool.

## Jika ada masalah

### Error saat membuka data akun

Pesannya bisa berupa `Cannot decrypt account vault` atau, pada versi lama:

```text
Unsupported state or unable to authenticate data
```

Artinya file akun tidak bisa dibuka dengan `ZCODE_MASTER_KEY` saat ini, atau file akunnya rusak. Error ini terjadi sebelum login ke ZCode.

1. Hentikan ZCode Gateway dan buat salinan `.env` serta `data/accounts.enc`.
2. Kembalikan `ZCODE_MASTER_KEY` asli yang dipakai saat file akun dibuat. Jika data dipindahkan dari VPS, gunakan nilai asli yang cocok dengan data itu.
3. Coba baca akun lagi dengan `node --env-file=.env src/cli.ts accounts`.

Jangan menghapus `data/accounts.enc` atau membuat `ZCODE_MASTER_KEY` baru untuk membuka akun lama. Kunci baru tidak bisa membuka data tersebut. Jika memakai `ZCODE_MASTER_KEY_FILE`, isinya yang dipakai. Nilai yang sudah diatur di terminal juga didahulukan daripada `.env`.

### Data akun sedang dipakai

Hentikan proses `serve` sebelum menjalankan perintah akun. Jika sebelumnya proses berhenti mendadak, periksa apakah prosesnya masih berjalan. Hapus `data/vault.lock` hanya setelah memastikan proses tersebut sudah berhenti.

### Login di VPS tidak membuka browser

Jalankan dengan `--no-browser`, lalu buka URL yang muncul di browser laptop. Biarkan terminal VPS tetap menunggu:

```sh
node --env-file=.env src/cli.ts login zai "Akun pertama" --no-browser
```

### Kuota tidak terbaca atau muncul kode 3012

Data kuota memerlukan `X-Device-Mid` dari aplikasi ZCode. `provision` mengambilnya jika tersedia. Jika data ini tidak ada atau ZCode gagal melaporkan kuota, saldonya dianggap belum diketahui, bukan nol.

Kode `3012` berarti ZCode menolak request karena pemeriksaan akun. ZCode Gateway menjeda akun itu selama 15 menit dan mengembalikan error. Jeda ini tidak menjamin blokir sudah berakhir. Jika login ditolak, login ulang akun tersebut.

### Responses tidak bisa melanjutkan percakapan

Untuk `previous_response_id` melalui OmniRoute, aktifkan penyimpanan detail request dan matikan No-Log pada API key pemanggil. Pada OmniRoute 3.8.52-web, kirim `input` pertama sebagai array pesan. Jika tidak menyimpan log, kirim riwayat percakapan lengkap pada setiap request.

Jika langsung memakai ZCode Gateway, riwayat disimpan di memori selama maksimal satu jam, terpisah per API key. Restart menghapusnya. Batasnya 100 catatan, masing-masing maksimal 512 KiB. Dengan `store:false`, kirim riwayat lengkap sendiri.

## Menjalankan dengan Docker

Selesaikan langkah `init`, `provision`, dan login terlebih dahulu. Lalu jalankan:

```sh
docker compose up -d --build
```

Container memakai UID 1000 dan perlu izin menulis ke folder `data`. Pada Linux, sesuaikan kepemilikan folder tersebut. Contoh Compose hanya membuka port di `127.0.0.1:8080`.

Jika OmniRoute memakai Docker, sambungkan keduanya ke jaringan Docker yang sama untuk memakai alamat `http://zcode-gateway:8080/v1`. Untuk akses lewat internet, siapkan HTTPS dan pastikan API key tetap diwajibkan.

## Pengaturan tambahan

| Nama | Isi dan kegunaan |
|---|---|
| `ZCODE_API_KEYS` | API key untuk aplikasi yang terhubung; pisahkan dengan koma jika lebih dari satu. Minimal 24 karakter per nilai. |
| `ZCODE_API_KEYS_FILE` | Lokasi file berisi nilai `ZCODE_API_KEYS`, jika ingin menyimpannya dalam file terpisah. |
| `ZCODE_MASTER_KEY` | Kunci untuk menyimpan dan membuka data akun. Minimal 32 karakter. |
| `ZCODE_MASTER_KEY_FILE` | Lokasi file berisi nilai `ZCODE_MASTER_KEY`, jika ingin menyimpannya dalam file terpisah. |
| `ZCODE_DATA_DIR` | Folder data akun. Default `./data`. |
| `HOST`, `PORT` | Alamat dan port tempat layanan berjalan. |

Jangan unggah `.env`, folder `data`, token login, atau tautan login ke tempat publik. File tersebut sudah dikecualikan dari Git. Jika pindah server, pertahankan pasangan data akun dan `ZCODE_MASTER_KEY` yang cocok.

## Batasan dan pengujian

- Gambar harus berupa base64 PNG/JPEG/WebP/GIF. URL gambar dari internet belum didukung.
- Jaminan format JSON sesuai schema dan `strict` pada tools belum didukung.
- Ukuran request maksimal 8 MiB, dengan batas waktu 180 detik.
- Jalankan satu proses untuk satu folder data akun.
- Konteks yang diwajibkan ZCode ikut dikirim, sehingga menambah token input dan memengaruhi jawaban model.
- `data/template.json` berisi bagian dari aplikasi ZCode serta informasi komputer saat `provision` dijalankan. File ini dibuat secara lokal dan tidak dibagikan dalam repositori.

Untuk memeriksa kode tanpa memakai akun ZCode:

```sh
npm test
npm run check
```

Untuk menguji request sungguhan:

```sh
node --env-file=.env scripts/smoke.mjs
node --env-file=.env scripts/tools-smoke.mjs
node --env-file=.env scripts/capabilities-smoke.mjs
```

Tiga perintah terakhir memakai kuota akun. Uji tool memakai hasil contoh; uji gambar membuat gambar merah/biru di memori. Pengaturan pengujian lebih lanjut ada di [panduan Inggris](README.en.md#verification); hasil dan batas verifikasi ada di [catatan pengujian](docs/verification.md).

## Referensi dan lisensi

Kode proyek ini memakai lisensi [MIT](LICENSE). File pribadi yang diambil dari aplikasi ZCode tetap mengikuti hak pemiliknya.

Penelitian awal merujuk [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api) pada commit `00501ce0e26e0276b9e858e9149299a62d91c7e5`. Revisi tersebut memakai CC-BY-NC-SA-4.0; implementasi dan aset prompt-nya tidak disalin ke repositori ini. Referensi lain: [dsh-zcode-cli-proxy](https://github.com/kyle123740/dsh-zcode-cli-proxy) dan [diskusi OmniRoute 9056](https://github.com/cheaper-inference/OmniRoute/discussions/9056).
