# Design: Registrasi Slash Command Per-Bot (Multibot) — Increment 1

Status: **diimplementasikan (increment 1) — menunggu verifikasi E2E 2 token** · Sesi brainstorming: 2026-09-25

## Latar Belakang & Diagnosis

Gejala: pada mode multibot, `/command` tidak jalan untuk bot kedua. Investigasi (termasuk
pembacaan source `@sapphire/framework@5.5.0` dan `@sapphire/pieces@4.4.1`) menemukan tiga
lapis penyebab yang saling independen:

1. **#1 Registrasi hanya men-target satu aplikasi.** Registrasi Sapphire
   (`CoreReady → handleRegistryAPICalls()`) memakai `container.client.application.commands`.
   Tiap token = aplikasi Discord terpisah; slash command bersifat per-aplikasi. Upaya
   menonaktifkannya di nada-bot tidak efektif:
   `loadApplicationCommandRegistriesStatusListeners: false` hanya mematikan listener
   *status*; patch `CoreReady.run` di `build()` kena `undefined` untuk bot #1 (store masih
   kosong) dan menimpa instance lama yang dibuang `loadAll()` untuk bot #2.
2. **#2 Store global: listener pindah klien.** `SapphireClient` melakukan
   `container.client = this` dan `this.stores = container.stores` (registry global).
   Setiap `login()` menjalankan `loadAll()` tanpa guard yang mencegah pemanggilan kedua:
   semua piece dibongkar lalu dibangun ulang dan ter-attach ke `container.client` terbaru.
   Event forwarding di `Rawon.build()` (`container.client !== this`) tidak pernah aktif
   karena diperiksa saat `build()` klien itu sendiri.
3. **#3 Gerbang `shouldRespond` menolak bot non-primer.** `getResponsibleBot()` selalu
   memilih bot primer (index 0) bila ada di guild yang sama;
   `InteractionCreateListener` menolak slash command non-musik dari bot non-primer dengan
   balasan ephemeral "wrong bot". Command musik lolos via `isPlaybackMusicCommand`.

**Increment ini hanya membereskan #1.** #2 dan #3 dijadwalkan sebagai increment
berikutnya, dibantu bukti dari logging diagnostik (di bawah).

## Scope

### Yang dibangun

- Registrasi slash command deterministik per-bot: setiap klien mendaftarkan command ke
  aplikasinya sendiri lewat `client.application.commands.set(...)` (bulk overwrite).
- Neutralisasi jalur otomatis Sapphire secara andal di mode multibot.
- Logging diagnostik per `clientReady`.

### Non-goals

- Tidak membereskan #2 (listener ownership) dan #3 (gerbang wrong-bot). Gejala sisa yang
  diharapkan setelah increment ini: slash command non-musik sebagai bot #2 di guild yang
  sama dengan bot primer tetap ditolak ephemeral.
- Tidak mengubah mode single-bot dan jalur sharding.
- Tidak ada re-register saat runtime (keputusan YAGNI).

## Desain

### Komponen (3 file, tanpa dependensi baru)

1. **`Rawon.login()` di-override.** Replikasi urutan `SapphireClient.login()`:
   `registerPath` → `loadAll()` → patch `CoreReady.run = no-op` (hanya jika
   `config.isMultiBot`) → `super.login()`. Window antara `loadAll()` dan `super.login()`
   adalah satu-satunya titik deterministik: piece `CoreReady` fresh sudah ada di store dan
   instance itulah yang ter-attach. Patch lama di `build()` dihapus.
   - Trade-off: override melewati plugin-hook Pre/PostLogin Sapphire — nada-bot tidak
     memakai plugin; dicatat sebagai batasan.
2. **`buildApplicationCommandData(client)`** (modul util baru): iterasi
   `client.stores.get("commands")`; ambil `options.chatInputCommand` (chat input) dan
   `contextChat`/`contextUser` (context menu) dari piece yang tidak `disable`; hormati
   gate `config.enableSlashCommand`. Output satu array `ApplicationCommandData`, dibangun
   sekali dan di-cache di level launcher (identik antar bot).
3. **Registrasi per-bot di `MultiBotLauncher.createBotInstance`**, pada handler
   `clientReady` yang sudah ada:
   - `isDev` → `guild.commands.set(...)` per guild `mainServer` (mirror perilaku lama).
   - Selain itu → `client.application.commands.set(...)` global.
   - Background, non-fatal.

### Alur startup (2 token, sekuensial)

1. `client1.login()` → `loadAll()` → patch CoreReady → `super.login()` (tanpa registrasi
   otomatis).
2. `client1` ready → build data (cache) → `set()` ke aplikasi bot #1.
3. `client2.login()` → `loadAll()` (piece dibangun ulang — normal) → patch CoreReady
   instance fresh → `super.login()`.
4. `client2` ready → pakai cache → `set()` ke aplikasi bot #2.

### Error handling

- Gagal `set()` → `log.error` dengan `application.id` + alasan; non-fatal; self-healing
  saat restart berikutnya (bulk overwrite idempoten).
- `isDev`: gagal fetch satu guild `mainServer` → log, lanjut guild berikutnya.
- Data kosong / `enableSlashCommand=false` → skip.
- Guard defensif `client.application` null.

### Logging diagnostik (tiap `clientReady`)

Semua baris launcher milik satu bot diemit lewat child logger pino yang membawa bindings
`bot: "#<index> <tag>"` — setiap baris log/error otomatis teratribusi jelas ke bot
pemiliknya, termasuk konteks `{ err, phase }` pada kegagalan registrasi. Baris
diagnostik per bot:

- `application.id` + jumlah command ter-register.
- Konfirmasi patch CoreReady applied (di-log dari `Rawon.login()`).
- `listenerCount` untuk `interactionCreate`/`messageCreate`/`voiceStateUpdate` dan
  `isContainerClient` — bukti ownership listener untuk increment #2/#3.

## Testing

Project tidak punya harness test otomatis (tidak ada script `test` di `package.json`), jadi:

1. **Build & lint:** `pnpm lint` (biome) + `pnpm build` (swc) lolos.
2. **E2E manual 2 token (dev):**
   - Log per bot memunculkan application.id yang **berbeda** + jumlah command sama + patch
     CoreReady applied.
   - Di Discord: ketik `/` → kedua bot menampilkan daftar command.
   - Invokes sebagai bot #2: command musik → berjalan (jika listener menempel di klien
     tsb — lihat log diagnostik); command non-musik → ephemeral wrong-bot (diharapkan,
     #3 out of scope).
   - Log diagnostik `listenerCount` dicatat sebagai bukti untuk increment berikutnya.
3. **Single-bot:** jalur lama tidak berubah — `pnpm dev` mode single berperilaku seperti
   sebelumnya.
4. **Rollback:** revert commit; tidak ada skema data/migrasi baru.

## Decision Log

| # | Keputusan | Alternatif ditolak | Alasan |
|---|-----------|--------------------|--------|
| 1 | Increment 1 = perbaiki #1 saja | Perbaiki #1+#2+#3 sekaligus | Blast radius kecil; #2/#3 butuh bukti runtime dulu (diagnostik) |
| 2 | Pendekatan A: registrasi manual per-bot | B: satu proses per bot; C: perbaiki semua in-process | A terkecil risikonya; B ideal tapi mahal (koordinasi antar-proses, SQLite bersama); C melawan desain global Sapphire |
| 3 | Netralkan CoreReady via override `login()` (patch antara `loadAll()` dan `super.login()`) | Patch di `build()` (terbukti rusak oleh rekonstruksi `loadAll`); unload piece (quirk framework: listener `once` tidak di-detach saat unload, tetap menembak) | Satu-satunya window deterministik |
| 4 | Bulk overwrite `commands.set()` per aplikasi; dev = guild `mainServer` | Append/update per command (perilaku default Sapphire) | Deterministik, self-healing, menghapus command stale |
| 5 | Registrasi hanya saat startup | Re-sync runtime | YAGNI (keputusan user) |
| 6 | #3 (gerbang wrong-bot) out of scope increment ini | Perluas scope | Rekomendasi diterima user; untuk setup 2 bot klien terakhir memegang listener sehingga command musik bot #2 kemungkinan besar sudah berfungsi penuh |
| 7 | Melewatkan plugin-hook Pre/PostLogin | Tidak meng-override `login()` | Tidak ada plugin Sapphire yang dipakai; dicatat sebagai batasan upgrade |
| 8 | Logging diagnostik masuk scope | Tanpa diagnostik | Ketidakpastian runtime #2 harus diubah jadi bukti, bukan tebakan |
| 9 | Testing = build + lint + checklist E2E manual | Menambah harness test | Project belum punya harness; menambahnya di luar scope YAGNI |

## Risiko

- Override `login()` coupling ke internal Sapphire — pin versi framework; tambahkan
  komentar di titik override; uji ulang saat upgrade major.
- Bila ownership listener (#2) berperilaku lain dari prediksi statis, salah satu bot bisa
  "tuli" — diagnostik akan menunjukkannya; perbaikan ditunda ke increment #2.
- Asumsi skala 2–5 bot: `set()` bulk per aplikasi per startup aman dari rate limit.
- Deskripsi i18n command di-capture saat build data — sama dengan perilaku hari ini.
