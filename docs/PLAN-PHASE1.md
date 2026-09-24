# Rencana Implementasi — Fase 1: Ekstraksi `PlaybackEngine`

> Mengacu [DESIGN-MERGE.md](./DESIGN-MERGE.md) §8 Fase 1. Target: refaktor murni **tanpa perubahan perilaku**. Mode implisit `rawon` (belum ada `ENGINE_MODE`).

## Prinsip

1. **ServerQueue tetap pusat logika antrean** (loop/shuffle/autoplay/persistensi/vote-skip/pesan). Ia jadi konsumen antarmuka `PlaybackEngine`.
2. **NativeEngine memiliki AudioPlayer + pipeline audio** (getStream → FFmpeg → AudioResource → player.play) yang dipindah dari `play.ts`.
3. **Antarmuka voice-agnostic** — tidak boleh membocorkan tipe `@discordjs/voice` agar `LavalinkEngine` (Fase 2) bisa mengimplementasikannya.
4. Setiap langkah diakhiri build hijau (`pnpm lint` + `pnpm tscompile`).

## Struktur baru

```
src/utils/engines/
├── types.ts            # PlaybackEngine, PlaybackStatus, EngineMode, EngineEvents, FilterState
├── EngineResolver.ts   # createEngine(client) → PlaybackEngine (Fase 1: selalu NativeEngine)
└── native/
    └── index.ts        # NativeEngine implements PlaybackEngine
```

## Perubahan per file

| File | Perubahan |
|---|---|
| `src/utils/engines/types.ts` (baru) | Interface: `connect()`, `startPlayback()`, `pause()`, `resume()`, `stopCurrent()`, `setVolume()`, `getStatus()`, `getElapsedSeconds()`, `getCurrentTrack()`, `recoverConnection()`, `destroy()`; event `trackStart`/`trackEnd`/`playbackError`/`debug` via EventEmitter. |
| `src/utils/engines/EngineResolver.ts` (baru) | Factory; Fase 1 kembalikan NativeEngine tanpa membaca config. |
| `src/utils/engines/native/index.ts` (baru) | Kode dipindah: pembuatan AudioPlayer (dari field ServerQueue L85), pipeline `play.ts` L139–296 + L469–603, transaksi stateChange→event (Playing→`trackStart`, Idle→`trackEnd`, error→`playbackError`), `joinVoiceChannel` (dari handleVideos L388–396 & ReadyListener L509–521 → `connect()`). |
| `src/structures/ServerQueue.ts` | Field `player` → `engine`; tiga listener player di konstruktor → handler event engine (isi handler dipertahankan verbatim); `playing`/`volume` setter mendelegasi ke engine; tambah fasad `getCurrentPosition()`, `stopCurrent()`, `isPaused`, `voiceChannelId`; hapus akses `player`/`connection` dari permukaan publik. |
| `src/utils/handlers/general/play.ts` | Tetap sebagai orkestrator antrean: pemilihan lagu, alur queue-ended, taxonomy error (AllCookiesFailed/ExpiredDirectMedia/requeue/AgeRestricted). Bagian pipeline audio → panggil `queue.engine.startPlayback(...)`. Signature `play(guild, nextSong?, wasIdle?, seekSeconds?)` **tidak berubah** (SkipTo/Seek/idle-handler tetap kompatibel). |
| `src/utils/handlers/general/handleVideos.ts` | `joinVoiceChannel` + assignment `connection` → `queue.engine.connect(...)`. |
| `src/listeners/ReadyListener.ts` | Sama: pembuatan koneksi → `engine.connect(...)`; restore lainnya tak berubah. |
| 9 command musik | Ganti baca `player.state.resource.metadata` → `queue.getCurrentSong()`; `player.stop(true)` → `queue.stopCurrent()`; posisi `resource.playbackDuration + seekOffset` → `queue.getCurrentPosition()`. |
| `src/listeners/VoiceStateUpdateListener.ts` | `player.pause()/unpause()` → `queue.engine.pause()/resume()`; `configureNetworking()+entersState` → `queue.engine.recoverConnection()`; baca status → `queue.engine.getStatus()`. |
| `src/utils/structures/RequestChannelManager.ts` | `player.state.status === Paused` → `queue.isPaused`. |

## Urutan eksekusi (build hijau di tiap batas)

1. Buat `types.ts` + `EngineResolver.ts` + `NativeEngine` (file baru; belum ada yang memakai).
2. Refaktor `ServerQueue` → pakai engine; pindahkan listener ke event engine.
3. Pangkas `play.ts` → orkestrator + `engine.startPlayback`.
4. Migrasi `handleVideos` + `ReadyListener` → `engine.connect`.
5. Migrasi command + listener + RequestChannelManager ke fasad.
6. Bersihkan sisa impor `@discordjs/voice` di luar folder `engines/native`.

## Verifikasi perilaku tak berubah

- `pnpm lint` dan `pnpm tscompile` bersih.
- `pnpm build` sukses (swc).
- Audit diff: hanya pemindahan kode + penggantian nama akses; tidak ada perubahan kondisi/logika — setiap blok yang dipindah dibandingkan baris-per-baris terhadap aslinya.
- Smoke manual (butuh token Discord, di luar sesi ini): play → skip → seek → filter → volume → stop, dan restart-restore antrean.

## Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Kehilangan kondisi transisi stateChange yang presisi (mis. Playing-setelah-Paused tidak boleh memicu trackStart) | Kondisi lama disalin verbatim ke penerjemah event NativeEngine. |
| Error taxonomy play.ts bergantung error bertipe dari `getStream` | `startPlayback` melempar error yang sama tanpa dibungkus; catch block orkestrator tak berubah. |
| Siklus impor ServerQueue ⇄ NativeEngine | Sisi NativeEngine hanya `import type`; runtime satu arah. |
| VoiceStateUpdateListener 750 baris | Hanya ganti panggilan akses, tidak menyusun ulang logikanya. |
