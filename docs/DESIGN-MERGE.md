# Desain Merger: nada-bot (rawon × musicify) — Dual-Engine via Config

> **STATUS: FINAL (revisi 4) — disetujui pengguna, 2026-09-24.**
> Understanding Lock terkonfirmasi; seluruh asumsi (A1, A3–A8) dan keputusan (K1–K3) disetujui.
> ✅ = keputusan eksplisit pengguna.

---

## 1. Ringkasan Pemahaman (Understanding Summary)

- **Apa yang dibangun**: `nada-bot` = penggabungan seluruh fitur `rawon` dan `musicify` menjadi satu bot dengan **dua mode playback**: **mode `musicify`** (engine Lavalink v4) dan **mode `rawon`** (engine bawaan yt-dlp + FFmpeg + @discordjs/voice). Mode ditentukan **satu konfigurasi global** — tanpa fitur ganda yang redundan.
- **Basis**: `nada-bot` saat ini adalah clone persis `rawon` → rawon menjadi fondasi; fitur musicify diporting masuk.
- **Untuk siapapun**: bot publik multi-guild ⚠️ (top.gg, status page, sharding).
- **Non-goals**: dua engine tidak pernah berjalan bersamaan — **hanya satu yang aktif seluruh bot, dipilih lewat config**; tidak ada pergantian mode per-guild; tidak ada failover lintas engine; tidak menambah fitur baru di luar gabungan kedua bot; non-komersial.

## 2. Keputusan Pengguna (tersimpan)

| # | Keputusan |
|---|---|
| ✅ K1 | Dua mode playback: Lavalink **dan** bawaan rawon (bukan salah satu saja). |
| ✅ K2 (revisi) | **Tepat dua mode**: `musicify` (Lavalink) dan `rawon` (native). Pengecekan mode **hanya dari config global** (`ENGINE_MODE=musicify\|rawon`) demi kesederhanaan — tanpa command `/engine`, tanpa nilai `auto`, tanpa failover lintas engine. Berganti mode = ubah config + restart. |
| ✅ K3 | Kebijakan YouTube **blokir ala musicify di mode `musicify`**: link youtube.com ditolak dengan pesan error (hanya YT Music); di mode `rawon` youtube.com tetap boleh diputar. |

## 3. Asumsi (disetujui bersama desain, 2026-09-24)

| # | Asumsi |
|---|---|
| A1 | Klien Lavalink: **riffy** (pola recovery/rate-limit musicify portable langsung). |
| A8 | Nilai default `ENGINE_MODE` = **`rawon`** (bot langsung jalan tanpa server Lavalink; mode `musicify` aktif bila infra node tersedia). |
| A3 | Deployment publik penuh: top.gg aktif, status page publik, sharding otomatis, welcome card. |
| A4 | Target non-fungsional: respons command < 2 dtk, mulai playback < 3 dtk, uptime 24/7. |
| A5 | Database `better-sqlite3` (rawon) + scheduler backup musicify di atasnya. |
| A6 | i18n: sistem rawon + port `de.json` → 15 locale. |
| A7 | DJ mode & lyrics (fitur rawon) dipertahankan — konsisten dengan tujuan "semua fitur". |

## 4. Arsitektur Dual-Engine

### 4.1 Lapisan Abstraksi Engine

`ServerQueue` rawon direfaktor menjadi konsumen **antarmuka `PlaybackEngine`** — semua logika antrean (loop/shuffle/vote-skip/persistensi/riwayat) menjadi engine-agnostic dan tinggal satu implementasi:

```
config: ENGINE_MODE ──> EngineResolver (dibaca saat startup)
                          ├─ "musicify" ──> LavalinkEngine  (riffy; sumber multi-platform via plugin node)
                          └─ "rawon"    ──> NativeEngine    (yt-dlp → FFmpeg → @discordjs/voice + cache + cookie)
ServerQueue ──> PlaybackEngine aktif (satu-satunya, seumur proses)
```

- `PlaybackEngine` menstandarkan: `resolve(query)`, `play(track, {position})`, `pause/resume/stop/seek/setVolume/applyFilters`, `destroy()`, plus event ternormalisasi (`trackStart/trackEnd/trackError/queueEnd`) yang diterbitkan ke `ServerQueue` lewat bus tunggal.
- Engine tidak aktif **tidak diinisialisasi sama sekali** — tanpa koneksi node, tanpa unduh yt-dlp (tetap diunduh hanya bila mode `rawon`).
- `/stats` dan `/status` menampilkan mode aktif + telemetry engine terkait (node Lavalink / versi yt-dlp & cache).

### 4.2 Ketahanan (per engine, internal)

- **Mode `musicify`**: pemulihan outage ala musicify tetap berlaku — node backup, snapshot antrean + posisi, resume saat node pulih, refresh node berkala 30 menit, insiden tercatat ke tabel `incidents`.
- **Mode `rawon`**: tidak melibatkan Lavalink; ketahanan datang dari persistensi antrean 5 dtk, cache audio, dan rotasi cookie.
- **Tanpa failover lintas engine** (konsekuensi K2): mode `musicify` saat node total down → playback berhenti dengan pesan error; solusinya admin mengubah config dan restart.

### 4.3 Mapping Filter Ganda

Satu registry preset → dua builder: payload Lavalink (mode `musicify`) dan argumen FFmpeg (mode `rawon`). Mode `rawon` mendapat set penuh (±21 preset gabungan, termasuk echo/reverb dsb.); mode `musicify` mendapat subset yang punya padanan native v4 (bassboost, nightcore, vaporwave, spedup, slowed, treble, 8d, surround, haas, tremolo, vibrato, karaoke, lowpass, slowmode, distortion). Preset tak tersedia di mode aktif → pesan "filter X tidak tersedia di mode Y" (degrade jujur).

### 4.4 Fitur yang Aktif per Mode

| Fitur | musicify | rawon |
|---|---|---|
| Sumber: YouTube/YT Music/SoundCloud/direct URL | ✔ | ✔ |
| Sumber: Spotify/Deezer via match YT Music | ✔ (plugin + enrichment) | ✔ (match client-side) |
| Sumber: Apple/Tidal/Qobuz/JioSaavn (plugin) | ✔ | ✖ (pesan jelas) |
| link youtube.com | ✖ (K3, pesan error) | ✔ |
| Audio cache, cookie, `login`, auto-update yt-dlp | dorman | ✔ |
| ChatPlay, musicard, semua command gabungan | ✔ | ✔ |

## 5. Peta Fitur & Deduplikasi

**Leburan sistem tumpang tindih:**
| Overlap | Keputusan |
|---|---|
| request channel × ChatPlay | **ChatPlay terpadu**: satu channel musik, satu pesan player persisten (musicard "Bloom", refresh 15 dtk, 10 tombol + dropdown saran), auto-recreate; mode request per-channel `chat`/`command`; modal Components V2 (slowmode, auto-delete, pin, default 24/7, smart filter). |
| pause/resume | Satu command `pause` (toggle); `resume` = alias prefix. |
| repeat × loop | Nama slash `loop` (off/track/queue); `repeat`, `music-repeat`, `music-loop` = alias prefix. |
| 24/7 tersembunyi × command | Command `/247`; default global tetap di `setup`. |
| about × about/stats | `about` = info/branding; `stats` = telemetry live (+ mode & engine aktif). |
| i18n, DB, loader | Sistem rawon menang; `de.json` + backup scheduler musicify diporting. |
| Autoplay | Engine-agnostic: riwayat anti-repeat 30 lagu + watchdog 8 dtk; pengambilan lagu terkait via engine aktif (plugin LL / YT-Mix radio rawon). |
| Riwayat 30 × previous 20 | Satu store riwayat (30) untuk anti-repeat dan `previous`. |
| Timeout idle | 30 dtk idle / 15 dtk sendiri (musicify) + auto-pause & deaf-pause (rawon). |

**Daftar command final — 38 slash (semua dengan varian prefix):**

*Music (23)*: `play` (+autocomplete & pilihan tersimpan), `search`, `pause`, `stop`, `skip` (+vote), `skipto`, `previous`, `replay`, `seek`, `queue`, `nowplaying`, `remove`, `clear`, `move`, `shuffle`, `loop`, `autoplay`, `volume`, `filter`, `lyrics`, `dj`, `247`, `chatplay` (alias prefix: `requestchannel`, `rc`, `reqchannel`, `musicchannel`).

*General (10)*: `help`, `about`, `ping`, `invite`, `language` (+mode `auto`), `prefix`, `stats`, `status` (+insiden), `troubleshoot`, `profile`.

*Developer (5)*: `setup`, `eval`, `login` (relevan mode `rawon`), `db-export`, `db-import`.

**Skema DB**: `guilds` (+volume persist default 75, binding 24/7, opsi ChatPlay, profil branding), `request_channels` (migrasi mode default `command`), `player_states` + `queue_states` (+snapshot recovery), `incidents`, `bot_settings`, baru `users` (snooze vote). `cookies_state` tetap (mode `rawon`). Mode engine **tidak** disimpan di DB — hanya config.

**Deployment**: satu service Docker (Dockerfile rawon sudah memuat ffmpeg/chromium/python) + node Lavalink eksternal (utama + backup) yang hanya dipakai mode `musicify`.

## 6. Error Handling & Edge Cases

- Node down saat mode `musicify` → pemulihan internal (backup node/snapshot); bila total gagal → pesan error jelas (tanpa failover lintas engine, per K2).
- Restart bot → antrean & posisi dipulihkan (persistensi 5 dtk) + sesi 24/7 reconnect ≤5x — berlaku kedua mode.
- Link youtube.com saat mode `musicify` → pesan error kebijakan + arahan ke YT Music.
- Rate limit resolve berlapis (global/guild/user) dengan pesan user-facing.
- Pesan player ChatPlay terhapus → auto-recreate; multi-bot satu guild → arbitrase VC/status rawon.

## 7. Strategi Testing

- Unit: registry filter (matrix kompatibilitas kedua engine), parser query, smart filter ChatPlay, `EngineResolver` (config → engine benar, nilai tak valid → error startup jelas).
- Integrasi: siklus play→pause→skip→stop di **kedua mode** (dua run CI terpisah per nilai `ENGINE_MODE`); pemulihan outage node di mode `musicify`.
- Smoke manual per fase + `/troubleshoot` sebagai audit izin live.

## 8. Fase Implementasi (usulan)

1. **Abstraksi engine**: ekstrak `PlaybackEngine` + `EngineResolver` dari internal rawon; `NativeEngine` membungkus pipeline lama — tanpa perubahan perilaku (`ENGINE_MODE` belum ada, default implisit `rawon`).
2. **LavalinkEngine** (riffy) + integrasi config + pemulihan internal musicify.
3. **ChatPlay terpadu** + musicard + tombol + migrasi `request_channels`.
4. **Layer resolusi multi-platform** + autocomplete + rate limiting.
5. **Ops**: status, troubleshoot, stats (dengan mode aktif), top.gg, backup, insiden.
6. **Polish**: profile, welcome card, locale `de`, audit dedup akhir.

## 9. Decision Log

| # | Keputusan | Alternatif | Alasan |
|---|---|---|---|
| D1 | **Dual-engine** (Lavalink v4 + native yt-dlp) | Lavalink saja; yt-dlp saja | Keputusan eksplisit pengguna (K1). |
| D2 | Basis kode rawon (TS/Sapphire) | basis musicify | Superset infrastruktur: prefix+slash, sharding, multi-bot, 14 locale, typing. |
| D3 | ChatPlay terpadu menyerap request channel | dua sistem paralel | Konsep identik; paralel = redundansi. |
| D4 | `better-sqlite3` | `node:sqlite` | Sudah di basis; scheduler backup tetap diport. |
| D5 | i18n rawon + `de` | i18next | 14→15 locale, satu sistem. |
| D6 | Seleksi mode: **config global `ENGINE_MODE=musicify\|rawon`**, tanpa per-guild, tanpa `auto` | per-guild `/engine` + failover otomatis | Keputusan eksplisit pengguna (K2 revisi): kesederhanaan > resilien lintas engine. |
| D7 | Ketahanan internal per engine (backup node + snapshot di musicify; persistensi/cache di rawon) | failover lintas engine | Konsekuensi langsung K2; resilien tetap ada di dalam masing-masing engine. |
| D8 | Klien: riffy ⚠️ | lavaclient | Pola musicify portable langsung. |
| D9 | YouTube: blokir ala musicify di mode `musicify` | izinkan + normalisasi | Keputusan pengguna (K3). |
| D10 | Deployment publik penuh ⚠️ | pribadi | Kehadiran top.gg/status page di musicify. |
| D11 | DJ mode & lyrics dipertahankan | ikut penghapusan musicify | Tujuan merger = semua fitur. |
| D12 | Resolver multi-platform engine-independent | khusus Lavalink | Fitur tetap berguna di mode `rawon` via match YT Music. |

## 10. Status Gerbang (exit criteria brainstorming)

- [x] Konteks kedua codebase dipetakan lengkap.
- [x] Keputusan engine, seleksi mode via config, dan kebijakan YouTube oleh pengguna (K1, K2 revisi, K3).
- [x] **Understanding Lock: konfirmasi ringkasan + asumsi A1, A3–A8 — "setuju", 2026-09-24.**
- [x] Pendekatan desain diterima secara eksplisit.
- Semua kriteria exit brainstorming terpenuhi → siap handoff implementasi.
