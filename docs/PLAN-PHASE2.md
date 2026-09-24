# Log Implementasi — Fase 2: LavalinkEngine + ENGINE_MODE

> Mengacu [DESIGN-MERGE.md](./DESIGN-MERGE.md) §4 & [PLAN-PHASE1.md](./PLAN-PHASE1.md) §8 Fase 2.
> Status: **selesai** — tscompile ✓, biome lint ✓, build swc ✓ (120 file).

## Yang dibangun

| Bagian | File | Keterangan |
|---|---|---|
| Config | `src/config/env.ts` | `ENGINE_MODE` (`rawon` default / `musicify`), node Lavalink utama+backup dari env, fail-fast saat `musicify` tanpa node. `dev.env.example` diperbarui. |
| Klien Lavalink | `src/utils/engines/lavalink/index.ts` → `initRiffy()` | Pola identik musicify: `send` per-shard, `ytmsearch`, REST v4, `bypassChecks.nodeFetchInfo`, forwarding paket voice mentah (`VOICE_STATE_UPDATE`/`VOICE_SERVER_UPDATE`, endpoint-null dilewati), event node → logger. Dipasang sebagai `client.riffy` (null di mode rawon), `riffy.init(userId)` di ReadyListener. |
| Engine | `src/utils/engines/lavalink/index.ts` → `LavalinkEngine` | Implementasi penuh `PlaybackEngine` per guild: player riffy, resolve URL → `queue.add` → `play()`, seek awal via `player.seek`, posisi absolut dikompensasi `_seekBaseSeconds` (paritas rumus `seekOffset + durasi`), event `trackStart/trackEnd/trackError/trackStuck` diterjemahkan + difilter per guild, `destroy()` melepas listener agar tidak bocor. |
| Resolver | `src/utils/engines/EngineResolver.ts` | `ENGINE_MODE=musicify` → `LavalinkEngine`; selain itu `NativeEngine`. |
| Antarmuka | `src/utils/engines/types.ts` | Tambahan: `mode`, `applyFiltersLive`, `resolveRelatedSong`, `destroy`, `connect(guild, voiceChannelId, textChannelId?)`. |
| NativeEngine | `src/utils/engines/native/index.ts` | `mode="rawon"`, `applyFiltersLive` selalu false (jalur restart FFmpeg dipertahankan), `resolveRelatedSong` mendelegasi ke `resolveAutoplayCandidate` lama. |
| ServerQueue | `src/structures/ServerQueue.ts` | `setFilter`: cabang live-apply (musikify) sebelum jalur restart; `resolveAutoplaySong` via `engine.resolveRelatedSong`; pra-cache audio & pra-cache autoplay digerbang `engine.mode === "rawon"`; `destroy()` memanggil `engine.destroy()`. |
| Kebijakan K3 | `src/utils/handlers/general/searchTrack.ts` | Mode musicify: link youtube.com/youtu.be dari pengguna **ditolak** dengan error; hasil pencarian internal **dinormalisasi** ke music.youtube.com (url & playableUrl). Engine juga menormalisasi di `startPlayback` (sabuk pengaman). |

## Filter mode musicify (12 preset termap)

bassboost, nightcore, vaporwave, spedup, slowed, 8d, tremolo, vibrato, karaoke, lowpass, slowmode, distortion — diterapkan **live tanpa restart lagu** (perbedaan UX yang disengaja vs native yang selalu restart). Preset lain (treble, reverse, surround, haas, phaser, gate, mcompand, flanger, echo, reverb) dilewati dengan `logger.warn`. Catatan: nightcore/spedup/slowed/vaporwave berbagi filter timescale — hanya satu aktif (model Lavalink bernilai tunggal).

## Deviasi dari desain (disengaja, jujur didokumentasikan)

1. **yt-dlp tetap diunduh di kedua mode** (lagi). Desain §4.1 menyasar "tanpa unduh yt-dlp di mode musicify", tetapi lapisan resolusi metadata/pencarian (`searchTrack`/`ytdlpMetadata`) masih berjalan klien dan bergantung yt-dlp; hanya jalur *streaming & cache* yang native-only. Kemandirian penuh (resolve via REST Lavalink) menjadi bagian Fase 4.
2. **K3 ditegakkan di intake `searchTrack`**, bukan di engine — blokir di engine akan mematikan play berbasis pencarian (hasil `ytsearch` ber-URL youtube.com). Pesan penolakan masih teks Inggris; i18n + penegakan per-command menyusul di Fase 4.
3. **Autoplay mode musicify** memakai `riffy.resolve(ytmsearch)` per lagu — bukan modul autoplay internal Lavalink — agar logika anti-repeat 30 lagu & prefetch ServerQueue tetap berlaku sama di kedua mode.
4. `socketClosed`/pemulihan snapshot antrean musicify (outage node) belum dipasang — masuk Fase 5 (ops) bersama status page & insiden.

## Verifikasi

- `pnpm tscompile` bersih; `pnpm lint` bersih (121 file); `pnpm build` sukses (120 file).
- Runtime **belum** diuji (butuh token Discord + node Lavalink). Uji dampak: `ENGINE_MODE=musicify` + node aktif → play/skip/seek/filter/volume/stop, lalu restart-restore antrean.
