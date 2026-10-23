# ZCode Gateway

[English](README.md) | [Bahasa Indonesia](README.id.md)

Gunakan akun ZCode Start Plan milik Anda melalui API yang kompatibel dengan OpenAI dan Anthropic. Gateway Node.js ini mendukung login OAuth, penyimpanan terenkripsi untuk banyak akun, streaming, dan percakapan dengan function tools. Jalankan langsung sebagai API atau hubungkan ke OmniRoute.

Proyek ini merupakan integrasi independen ke endpoint ZCode yang tidak terdokumentasi dan tidak berafiliasi dengan Z.ai. Kompatibilitas diperiksa menggunakan ZCode desktop **3.16.3**, dengan hak akses model **GLM-5.3** dan **GLM-5.3-Flash**. Perubahan di sisi penyedia dapat memengaruhi integrasi.

## Endpoint yang didukung

| Endpoint | JSON | SSE / streaming | Function tools |
|---|---|---|---|
| `POST /v1/chat/completions` | Ya | Ya | Pemanggilan dan hasil tool |
| `POST /v1/responses` | Ya | Ya | Pemanggilan, hasil, dan `previous_response_id` |
| `POST /v1/messages` | Ya | Ya | Anthropic `tool_use` dan `tool_result` |
| `GET /v1/models` | Model yang tersedia pada akun aktif | — | — |
| `GET /health` | Kesehatan proses, memerlukan autentikasi | — | — |
| `GET /api/usage` | Kuota penyedia, cache 60 detik | — | — |
| `GET /api/plans` | Paket akun dan rute yang dipilih | — | — |

Parameter sampling divalidasi dan diteruskan: `temperature` dan `top_p` bernilai 0–1, sedangkan `top_k` berupa bilangan bulat hingga 1000. Effort diterima melalui `reasoning_effort` pada Chat Completions, `reasoning.effort` pada Responses, atau `output_config.effort` pada Anthropic Messages. Jaminan structured output dan strict schema belum didukung; permintaannya menghasilkan error yang eksplisit.

Gateway mengembalikan permintaan tool kepada aplikasi pemanggil. Aplikasi tersebut yang menjalankan tool dan mengirim hasilnya kembali. Gateway tidak menjalankan perintah shell, membuka file, atau mengeksekusi tool di server. Hosted tools OpenAI seperti code interpreter dan web search tidak disediakan. Penggunaan format API OpenAI atau Anthropic tetap menggunakan model GLM dari akun ZCode Anda.

## Instalasi lokal

Memerlukan **Node.js 24.14 atau lebih baru**. Tidak ada dependensi npm untuk menjalankan layanan produksi.

```sh
git clone https://github.com/revanapriyandi/zcode-gateway.git
cd zcode-gateway
node src/cli.ts init
node --env-file=.env src/cli.ts provision "/path/to/official/ZCode/resources/glm/zcode.cjs"
node --env-file=.env src/cli.ts login zai "Akun pertama"
node --env-file=.env src/cli.ts serve
```

Pada instalasi Windows dengan lokasi berikut, gunakan:

```powershell
node --env-file=.env src/cli.ts provision 'C:\Program Files\ZCode\resources\glm\zcode.cjs'
```

Sesuaikan lokasi jika ZCode terpasang di direktori lain. Perintah `init` membuat `.env` dengan master key enkripsi dan API key klien yang diacak secara terpisah. Gunakan nilai `ZCODE_API_KEYS` dari file pribadi itu untuk konfigurasi aplikasi pemanggil. Server secara default berjalan di `127.0.0.1:8080`.

`provision` mengekstrak fungsi prompt yang didukung dari aplikasi resmi ke `data/template.json`. Perintah ini tidak menjalankan entrypoint aplikasi atau mengubah instalasi ZCode. Teks prompt penyedia **tidak disertakan di repositori** dan tidak tercakup oleh lisensi MIT proyek ini. Jika struktur bundle berbeda, ekstraksi dihentikan; verifikasi dahulu sebelum menggunakan versi aplikasi lain.

Template pribadi juga menyimpan platform, shell, locale, zona waktu, direktori kerja, dan device ID jika tersedia. Header upstream dan konteks mempertahankan profil tersebut ketika gateway dipindahkan ke VPS. Metadata ini tidak memberikan akses ke file atau tool laptop. Perlakukan sebagai data pribadi dan buat ulang template ketika sengaja berpindah profil klien.

## Login dan impor akun desktop

Perintah `login` menampilkan tautan otorisasi sekali pakai. Buka tautan di browser, pilih akun, lalu berikan otorisasi. CLI menunggu hasil melalui polling tanpa callback localhost. Provider login yang tersedia adalah `zai` dan `bigmodel`; verifikasi akun nyata pada rilis awal menggunakan Z.ai.

Browser default dibuka otomatis. Terminal yang mendukung hyperlink OSC 8 juga menampilkan tautan pendek **Open ZCode login**. URL lengkap tetap dicetak untuk disalin manual. Cara klik mengikuti terminal; Git Bash dapat memerlukan Ctrl+klik. Jika browser gagal dibuka otomatis, proses login tetap menunggu otorisasi manual. Untuk SSH atau saat ingin membuka tautan sendiri:

```sh
node --env-file=.env src/cli.ts login zai "Akun pertama" --no-browser
```

Jika sudah login pada aplikasi ZCode desktop di komputer yang sama:

```sh
node --env-file=.env src/cli.ts import-desktop "Akun desktop"
```

Perintah tersebut mengimpor login pengguna lokal saat ini ke vault terenkripsi. Token tidak dicetak ke konsol dan profil desktop tidak diubah.

Untuk menambah akun lain, jalankan `login` kembali dan pilih akun berbeda di browser. Anda juga dapat mengganti akun di aplikasi desktop lalu mengulang `import-desktop`. Identitas yang sama diperbarui tanpa membuat duplikat.

## Mengelola banyak akun

Hentikan gateway sebelum menjalankan perintah pengelolaan akun:

```sh
node --env-file=.env src/cli.ts login zai "Akun kedua"
node --env-file=.env src/cli.ts accounts
node --env-file=.env src/cli.ts quota
node --env-file=.env src/cli.ts disable ACCOUNT_ID
node --env-file=.env src/cli.ts enable ACCOUNT_ID
node --env-file=.env src/cli.ts remove ACCOUNT_ID
```

Ganti `ACCOUNT_ID` dengan ID dari perintah `accounts`. `remove` menghapus login dari gateway lokal; perintah itu tidak mencabut sesi di penyedia.

Pemilihan akun bergiliran di antara akun aktif yang memiliki akses model, dengan maksimal satu request berjalan per akun. Error kuota, autentikasi, atau gangguan sementara dapat mencoba akun lain sebelum isi respons dikirim. Setelah streaming dimulai, request tidak diputar ulang.

Penolakan risk control berkode `3012` menjeda akun secara lokal selama 15 menit dan mengembalikan error tanpa berusaha melewati blokir penyedia. Durasi itu merupakan kebijakan lokal, bukan jaminan waktu reset. Kredensial yang ditolak memerlukan login ulang; gateway tidak mengasumsikan adanya endpoint refresh yang belum terverifikasi.

Perintah `quota` membaca paket dan saldo yang dilaporkan penyedia. Nilai yang tidak tersedia tetap dianggap belum diketahui. Scheduler memakai hak akses model dan error penyedia, tanpa menebak saldo token dari field kosong. Gateway tidak mengklaim promosi secara otomatis.

Vault memakai AES-256-GCM dengan master key tersendiri. Hanya satu proses boleh mengakses vault pada satu waktu. Cadangkan master key dan data terenkripsi secara aman. Jika proses berhenti tidak normal, pastikan PID-nya sudah tidak berjalan sebelum menghapus `data/vault.lock` yang tertinggal.

## Mengatasi error enkripsi vault

Jika `accounts`, `login`, dan `import-desktop` gagal dengan pesan `Cannot decrypt account vault`, kegagalan terjadi saat membuka penyimpanan gateway sebelum login OAuth atau impor desktop. Versi sebelumnya menampilkan pesan berikut:

```text
Unsupported state or unable to authenticate data
```

Penyebabnya dapat berupa `ZCODE_MASTER_KEY` yang berbeda dari kunci pembuat `data/accounts.enc`, atau file terenkripsi yang rusak. Error ini sendiri tidak membuktikan bahwa akun ZCode logout.

Langkah pemulihan:

1. Hentikan gateway dan cadangkan `.env` beserta `data/accounts.enc` ke lokasi pribadi.
2. Pulihkan `ZCODE_MASTER_KEY` asli yang berpasangan dengan vault tersebut. Jika memindahkan data dari deployment lain, gunakan kunci asli deployment itu secara aman.
3. Periksa `ZCODE_MASTER_KEY_FILE` jika digunakan: nilainya diprioritaskan daripada `ZCODE_MASTER_KEY`. Variabel yang sudah ada di shell juga mengalahkan nilai dari `--env-file=.env`.
4. Jalankan kembali `node --env-file=.env src/cli.ts accounts` untuk memastikan vault dapat dibaca sebelum login atau impor.

Jangan menghapus vault atau membuat master key baru sebagai cara membuka akun lama. Kunci baru tidak dapat mendekripsi data lama. `init` menolak membuat kunci jika vault sudah ada. Jaga pasangan konfigurasi enkripsi dan direktori data tiap deployment; API key klien dapat berbeda dari deployment lain.

Jangan menempelkan master key, API key, token akun, `.env`, atau template pribadi ke issue GitHub maupun percakapan publik. `.env` dan `data/` diabaikan oleh Git.

## Memilih paket atau langganan

Setiap akun secara default memakai rute `start-plan`. Paket aktif, model, tanggal kedaluwarsa, dan saldo token ditemukan dari akun. Paket baru pada rute yang sama muncul saat kuota diperbarui. Penyedia menentukan bucket promosi yang dipotong; gateway tidak dapat memaksakan ID bucket sembarang.

```sh
node --env-file=.env src/cli.ts plans
node --env-file=.env src/cli.ts plan ACCOUNT_ID start-plan
node --env-file=.env src/cli.ts plan ACCOUNT_ID coding-plan --key-file /private/subscription-key --models glm-5.3,glm-5.3-flash
```

Rute `coding-plan` memerlukan API key langganan sendiri. Key dibaca dari file pribadi lalu disimpan terenkripsi di vault. Pergantian rute berlaku per akun, dan login ulang identitas yang sama mempertahankan pilihan rutenya. Coding Plan memakai endpoint Anthropic langganan tersendiri, terpisah dari masa berlaku JWT Start Plan. Rute ini sudah diuji dengan fixture; pengujian nyata memerlukan akun berbayar. Saldo langganan yang belum dilaporkan tetap belum diketahui. Pilih `start-plan` lagi untuk kembali ke rute promosi. Lihat [konfigurasi langganan penyedia](https://docs.z.ai/devpack/tool/claude).

Pembacaan billing memerlukan `X-Device-Mid` asli. Provisioning mengambilnya secara pribadi dari file telemetry desktop jika tersedia; login dan impor menyimpannya bersama akun. Tanpa device ID, kuota dapat tidak tersedia. Waktu berakhir kuota menunjukkan kedaluwarsa alokasi, bukan janji reset harian.

## Integrasi OmniRoute

Buat provider **OpenAI-compatible / Chat Completions** di OmniRoute. Isi base URL `/v1` gateway yang dapat dijangkau oleh router, lalu gunakan API key klien gateway. Impor model dari `/v1/models`.

Contoh pada jaringan Docker privat bersama:

```text
Base URL: http://zcode-gateway:8080/v1
Model: glm-5.3-flash atau glm-5.3
```

Prefix model pada OmniRoute mengikuti konfigurasi provider Anda. Dengan prefix `zcg`, ID yang digunakan aplikasi pemanggil menjadi `zcg/glm-5.3-flash` atau `zcg/glm-5.3`.

Klien Anthropic dapat memakai penerjemahan protokol OmniRoute. Gateway juga melayani Anthropic Messages secara langsung. Untuk `previous_response_id` melalui OmniRoute, aktifkan penyimpanan detail request dan nonaktifkan No-Log pada API key pemanggil. Pada OmniRoute 3.8.52-web, gunakan `input` Responses awal berupa array pesan karena histori input string tidak dapat dilanjutkan. Jika logging dimatikan, kirim riwayat lengkap. Gateway langsung memakai penyimpanan histori sendiri di memori. Pemasangan gateway tidak otomatis mengaktifkan logging prompt global router.

Provider kustom dapat menampilkan kuota melalui `providerSpecificData.quotaEndpoint` pada koneksi:

```json
{
  "url": "http://zcode-gateway:8080/api/usage",
  "auth": "bearer",
  "plan": "plan",
  "quotas": {
    "glm-5.3-flash": {
      "total": "quotaBuckets.glm_5_3_flash.total",
      "used": "quotaBuckets.glm_5_3_flash.used",
      "remaining": "quotaBuckets.glm_5_3_flash.remaining",
      "resetAt": "quotaBuckets.glm_5_3_flash.resetAt",
      "displayName": "GLM-5.3-FLASH tokens (grant expiry)"
    },
    "glm-5.3": {
      "total": "quotaBuckets.glm_5_3.total",
      "used": "quotaBuckets.glm_5_3.used",
      "remaining": "quotaBuckets.glm_5_3.remaining",
      "resetAt": "quotaBuckets.glm_5_3.resetAt",
      "displayName": "GLM-5.3 tokens (grant expiry)"
    }
  }
}
```

Nama field pada `quotaBuckets` tidak mengandung titik karena OmniRoute memisahkan jalur mapping pada titik. Field `quotas` tetap mempertahankan ID model asli. Koneksi memakai API key klien gateway yang sudah dikonfigurasi; token login upstream tidak diberikan kepada OmniRoute. Total merupakan agregat akun aktif. `/api/usage` juga memuat saldo per akun dan error kuota. Tambahkan mapping jika paket lain memperkenalkan bucket model baru.

## Menghubungkan aplikasi klien

Untuk klien OpenAI, gunakan base URL `http://127.0.0.1:8080/v1`, API key dari `ZCODE_API_KEYS`, dan model `glm-5.3-flash` atau `glm-5.3`. Contoh berikut untuk Bash / Git Bash; isi `GATEWAY_KEY` secara lokal tanpa membagikannya:

```sh
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"Halo"}],"reasoning_effort":"low","stream":true}'
```

Untuk klien Responses, gunakan base URL `/v1` yang sama dengan protokol Responses. Contoh konfigurasi Claude Code / klien Anthropic dalam Bash:

```sh
export ANTHROPIC_BASE_URL=http://127.0.0.1:8080
export ANTHROPIC_AUTH_TOKEN="$GATEWAY_KEY"
export ANTHROPIC_MODEL=glm-5.3-flash
```

## Docker dan konfigurasi

Lakukan provisioning dan login di host lebih dahulu. Container berjalan sebagai UID 1000 dan memerlukan akses tulis ke `data/`. Pada Linux, sesuaikan kepemilikan direktori, lalu jalankan:

```sh
docker compose up -d --build
```

Contoh Compose mempublikasikan port hanya pada `127.0.0.1:8080`. Jika OmniRoute berada pada jaringan Docker privat yang sama, hapus publikasi port dan hubungkan kedua container ke jaringan tersebut. Gunakan `http://zcode-gateway:8080/v1` sebagai base URL provider. Gunakan reverse proxy TLS jika gateway diakses melalui jaringan yang tidak tepercaya.

| Variabel | Fungsi |
|---|---|
| `ZCODE_MASTER_KEY` | Rahasia enkripsi wajib, minimal 32 karakter |
| `ZCODE_MASTER_KEY_FILE` | File alternatif berisi master key |
| `ZCODE_API_KEYS` | API key klien yang diizinkan, dipisahkan koma; masing-masing minimal 24 karakter |
| `ZCODE_API_KEYS_FILE` | File alternatif berisi API key klien |
| `ZCODE_DATA_DIR` | Direktori data pribadi; default `./data` |
| `HOST`, `PORT` | Alamat dan port layanan |

Bagikan tautan OAuth hanya kepada pemilik akun karena tautan tersebut merupakan bagian sesi login. Log gateway tidak menyertakan token upstream, API key klien, atau prompt. Kebijakan penyimpanan log router yang berada di depan gateway diatur secara terpisah.

## Kemampuan model dan batasan

- `/v1/models` menyediakan metadata yang dapat dibaca mesin: effort, modalitas, tools, format API, endpoint, konteks, dan batas output. Model yang tersedia mengikuti akun aktif dan paketnya.
- GLM-5.3-Flash mendukung input gambar; GLM-5.3 menerima teks saja. Gambar harus berupa base64 PNG/JPEG/WebP/GIF. URL gambar eksternal dan modalitas lain ditolak.
- GLM-5.3 selalu melakukan reasoning. Permintaan untuk mematikan thinking menghasilkan error. Pemetaan effort: `minimal` / `low` menjadi `low`, `medium` / `high` menjadi `high`, dan `xhigh` / `max` menjadi `max`. Lihat [dokumentasi thinking penyedia](https://docs.z.ai/guides/capabilities/thinking).
- Konteks identitas ZCode wajib menambah token input dan memengaruhi perilaku model. Instruksi pemanggil digabungkan ke blok konteks stabil yang diperlukan.
- Histori Responses langsung berada di memori, terpisah per API key, kedaluwarsa setelah satu jam, dan dibatasi 100 catatan dengan ukuran maksimal 512 KiB per catatan. Restart menghapusnya. Dengan `store:false`, kirim riwayat lengkap sendiri.
- Ukuran request maksimal 8 MiB dan batas waktu request 180 detik. Gateway tidak mengimplementasikan seluruh fitur produk OpenAI atau Anthropic.
- Layanan berjalan dalam satu proses. Jangan menjalankan beberapa replika terhadap satu file vault. Backend akun transaksional bersama untuk high availability belum tersedia.

## Pengujian

```sh
npm test
npm run check
node --env-file=.env scripts/smoke.mjs
node --env-file=.env scripts/tools-smoke.mjs
node --env-file=.env scripts/capabilities-smoke.mjs
```

`npm test` dan `npm run check` berjalan lokal. Skrip smoke mengirim request nyata dan memakai sedikit kuota penyedia: JSON/SSE pada ketiga protokol, kelanjutan Responses, hasil tool, streaming function call, dan vision Flash dengan effort rendah. Hasil tool berupa data sintetis; skrip tidak memanggil layanan cuaca. Gambar uji merah/biru dibuat di memori.

Gunakan `TEST_BASE_URL`, `TEST_API_KEY`, dan `TEST_MODEL` untuk deployment lain. Set `TEST_STATELESS=1` pada pengujian tools jika OmniRoute tidak menyimpan detail request. Jalankan berurutan jika hanya memiliki satu akun. Pengujian akun tiruan membuktikan perilaku scheduler; bukti akun nyata dan batas verifikasinya dicatat terpisah di [docs/verification.md](docs/verification.md).

## Referensi dan lisensi

- [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api), diperiksa pada commit `00501ce0e26e0276b9e858e9149299a62d91c7e5`, membantu mengidentifikasi penyusunan request dan alur OAuth. Implementasi, dependensi, serta aset prompt bundle-nya tidak disertakan dalam proyek ini. Lisensi pada revisi tersebut adalah CC-BY-NC-SA-4.0; penyebutan MIT pada README lama tidak menjadi acuan lisensinya.
- [kyle123740/dsh-zcode-cli-proxy](https://github.com/kyle123740/dsh-zcode-cli-proxy) mendokumentasikan alternatif app-server. Gateway ini tidak menjalankan agen coding otonom.
- [Diskusi OmniRoute 9056](https://github.com/cheaper-inference/OmniRoute/discussions/9056) mencatat batasan sebelumnya. Perilaku aktual perlu diperiksa terhadap akun dan versi klien yang digunakan.

Kode aplikasi dalam repositori ini berlisensi [MIT](LICENSE). Template runtime turunan vendor dan kredensial pribadi tetap berada di luar repositori.
