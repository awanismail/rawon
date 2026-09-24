# Log Implementasi — Fase 4: Resolusi Multi-Platform + Autocomplete + Rate Limiting

> Mengacu [DESIGN-MERGE.md](./DESIGN-MERGE.md) §4.1 (lapisan resolusi engine-independent) & §8 Fase 4.
> Status: **selesai** — tscompile ✓, biome lint ✓ (125 file), build swc ✓ (124 file).

## Yang dibangun

| Bagian | File | Keterangan |
|---|---|---|
| Klasifikasi | `src/utils/handlers/general/checkQuery.ts` + `src/typings/index.d.ts` | `sourceType` baru: `deezer`, `applemusic`, `tidal`, `qobuz`, `jiosaavn` (track/playlist/album terdeteksi dari path). |
| Deezer | `src/utils/handlers/general/deezerResolve.ts` (baru) | Track/playlist/album via API publik Deezer (paginasi ≤100, pola musicify); short link (`link.deezer.com`) dijabarkan; tiap track **dicocokkan ke YouTube Music** (pola `spotifyResolve`: dsp → `searchYouTubeMusic`, fallback `ytsearch1`, konkurensi 4) → `Song{url: deezer (tampilan), playableUrl: youtube (stream)}` — **engine-independent, jalan di kedua mode**. |
| Sumber plugin | `searchTrack.ts` | Apple Music/Tidal/Qobuz/JioSaavn: mode `musicify` → URL diteruskan apa adanya (plugin node LavaSrc dsb. yang memuat); mode `rawon` → `PluginSourceUnsupportedError` dengan pesan jelas (degrade jujur §4.4). |
| Rate limiting | `src/utils/functions/resolveLimiter.ts` (baru) + dependensi `bottleneck` | Tiga lapis ter-chain persis musicify: global 25 concurrent @25 ms, guild 10 @100 ms, user 3 @500 ms; antrean penuh → `ResolveRateLimitError`. Terintegrasi di `searchTrack` lewat parameter opsional `{guildId, userId}` — dipakai `/play` & autocomplete. |
| Autocomplete | `src/commands/music/PlayCommand.ts` | Opsi `query` kini `.setAutocomplete(true)` + `autocompleteRun`: pencarian dibatasi 2,5 dtk (balasan kosong bila lewat), hasil ≤25 → cache per-user (TTL 5 menit); memilih saran mengirim nilai `nadatrack:N` yang diambil dari cache **tanpa pencarian ulang** (pola musicify). |
| K3 bertipe | `searchTrack.ts` + `PlayCommand.ts` | `YouTubeNotSupportedInModeError` kelas error sendiri; `/play` menerjemahkannya ke pesan terlokalisasi (begitu juga `PluginSourceUnsupportedError` & `ResolveRateLimitError`). |
| Guard filter | `FilterCommand.ts` + `LL_SUPPORTED_FILTERS` (ekspor baru di engine lavalink) | Filter yang tak punya padanan Lavalink ditolak dengan pesan jelas di mode musicify — bukan di-senypim. |
| i18n | `lang/*.json` (14 file) | Kunci baru: `requestChannel.rateLimited`, `commands.music.play.youtubeNotSupportedMode` / `pluginSourceUnavailable`, `commands.music.filter.notAvailableInMode` (en-US & id-ID diterjemahkan; 12 lain placeholder Inggris). |

## Keputusan & catatan

1. **Deezer memakai jalur match YT Music di kedua mode** (bukan plugin `dcsearch:`) — konsisten dengan pola Spotify yang sudah ada di rawon dan memenuhi prinsip engine-independent (DESIGN-MERGE §4.1/D12). Plugin Deezer node tetap bisa dipakai nanti bila diinginkan.
2. **SoundCloud tidak di-port dari musicify** — rawon sudah memutar SC secara native via yt-dlp (lebih baik daripada match musicify); di mode musicify URL SC diteruskan ke node.
3. **Paginasi Spotify >50 lagu & scraping embed** belum ditambahkan ke `spotifyResolve` (rawon sudah punya resolusi Spotify sendiri via Web API) — dicatat sebagai polesan Fase 6 bila playlist besar jadi kebutuhan.
4. Autocomplete di mode `rawon` memakai jalur pencarian biasa (dsp/`searchYouTubeMusic` cepat; timeout 2,5 dtk menjaga respons). Di mode `musicify` masih memakai jalur yt-dlp — REST Lavalink untuk autocomplete menunggu pemindahan resolusi penuh (lihat deviasi Fase 2 #1).
5. Pesan error typed di alur ChatPlay (MessageCreate) masih menampilkan teks error mentah Inggris — lokalisasi di command-level saja untuk saat ini.

## Verifikasi

- `pnpm tscompile` ✓, `pnpm lint` ✓ (125 file), `pnpm build` ✓ (124 file).
- Runtime belum diuji. Uji dampak: `/play` ketik judul → autocomplete muncul → pilih → lagu masuk tanpa resolusi ulang; link `deezer.com/track/...` & `link.deezer.com/s/...` → dimainkan (judul Deezer, stream YT Music); playlist Deezer ≤100 lagu; link Apple Music di mode rawon → pesan "hanya mode musicify"; spam `/play` → pesan rate limit; `filter treble` di mode musicify → ditolak dengan pesan.
