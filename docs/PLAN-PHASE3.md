# Log Implementasi — Fase 3: ChatPlay Terpadu

> Mengacu [DESIGN-MERGE.md](./DESIGN-MERGE.md) §5 (ChatPlay terpadu menyerap request channel).
> Status: **selesai** — tscompile ✓, biome lint ✓ (123 file), build swc ✓ (122 file).

## Yang dibangun

| Bagian | File | Keterangan |
|---|---|---|
| Smart filter | `src/utils/functions/chatPlayMessageFilter.ts` (baru) | Port verbatim dari musicify: blocklist 61 token slang + normalisasi karakter berulang, tolak emoji-only/tanda-baca/mention, link musia selalu lolos. |
| Musicard | `src/utils/functions/musicCard.ts` (baru) + dependensi `musicard` 3.0.1 | Render tema **Bloom** (judul/artis/artwork/progress bar), lampiran `musicard.png`. Catatan: API musicard 3.x tidak lagi punya `volumeBar`/`progressBarColor` — memakai `styleConfig.progressBarStyle.barColor`. |
| Skema DB | `src/utils/structures/SQLiteDataManager.ts` | Kolom baru `request_channels`: `mode` (chat/command), `smart_filter`, `auto_delete`, `slowmode`, `pin_player` — migrasi PRAGMA+ALTER, `getRequestChannel`/`saveRequestChannel` diperluas. |
| Manager | `src/utils/structures/RequestChannelManager.ts` | `getRequestChannelOptions`/`setChatPlayOptions`; kartu musicard di pesan player (fallback gambar lama bila render gagal); **tombol `RC_QUEUE` 📜** (total 10 tombol); **dropdown `RC_SONG_SUGGESTION`** (top-10 saran via `engine.resolveSuggestions`, di-refresh tiap ganti lagu); **interval refresh 15 dtk** (render ulang kartu, hidup hanya saat playing); dukungan pin pesan player; cache saran per guild. |
| Mode & filter | `src/listeners/MessageCreateListener.ts` | Mode `command` → pesan teks diabaikan (hanya command); mode `chat` → smart filter opsional + auto-delete permintaan 3,5 dtk (menggantikan delete 60 dtk bila aktif). |
| Auto-recreate | `src/listeners/MessageDeleteListener.ts` | Perilaku dibalik dari *hapus konfigurasi* menjadi **membuat ulang pesan player** (paritas musicify). |
| Command | `src/commands/music/ChatPlayCommand.ts` (baru, lama dihapus) | `/chatplay set <channel> [mode] [smartfilter] [autodelete] [slowmode] [pin]`, `remove`, `status` (kini menampilkan kelima opsi); alias prefix: `requestchannel`, `rc`, `reqchannel`, `musicchannel`; slowmode 5 dtk diterapkan/dilepas otomatis pada channel. |
| Interaksi | `src/listeners/InteractionCreateListener.ts` | `RC_QUEUE` masuk map dispatch command; handler select `RC_SONG_SUGGESTION` → mengeksekusi command `play` dengan URL saran (ephemeral, lewat pipeline izin yang sama). |
| Engine | `types.ts` + native + lavalink | `resolveSuggestions(song): Song[]` — native via `searchTrack`, lavalink via `riffy.resolve(ytmsearch)` (helper bersama `trackToSong`). |
| i18n | `lang/*.json` (14 file) | Kunci `requestChannel.*` (filteredChat, suggestions, mode, opsi) + `commands.music.chatplay.*` — en-US & id-ID diterjemahkan, 12 locale lain placeholder Inggris (terjemahan → Fase 6). |

## Deviasi dari desain (disengaja, jujur didokumentasikan)

1. **Default migrasi `mode` = `chat`**, bukan `command` seperti tertulis di DESIGN-MERGE §5. Alasan: request channel rawon yang ada **sudah** memperlakukan teks sebagai permintaan lagu — default `chat` mempertahankan perilaku pengguna lama; `command` tetap tersedia via `/chatplay set`. (Koreksi atas draf desain.)
2. **Setup via slash options + subcommand**, bukan modal Components V2 ala musicify. Fungsionalitas identik (mode, smartfilter, autodelete, slowmode, pin); UX modal + panel kelola + forced-ephemeral reply di channel ChatPlay dicatat sebagai polesan Fase 6.
3. **Auto-delete default OFF** (musicify: ON) — mempertahankan perilaku rawon (pesan dihapus setelah 60 dtk); opsi mengubahnya jadi 3,5 dtk.
4. **Tombol `previous` ⏮️ belum ada** (10 tombol: 9 rawon + `RC_QUEUE`) — menunggu fitur `previous`/riwayat yang menjadi bagian merger (Fase 6); `RC_REMOVE` khas rawon tetap dipertahankan sesuai tujuan "semua fitur".
5. musicify memakai musik `musicard@latest` dengan `volumeBar`; versi 3.0.1 yang terpasang tidak menyediakan field itu — kartu dirender tanpa bar volume (tidak ada padanan di API stabil).

## Verifikasi

- `pnpm tscompile` ✓, `pnpm lint` ✓ (123 file), `pnpm build` ✓ (122 file).
- Runtime belum diuji (butuh token Discord). Uji dampak: `/chatplay set #ch` → kartu muncul; kirim judul lagu → masuk antrean + kartu berubah; aktifkan smartfilter → pesan "lol" ditolak; hapus pesan player → muncul lagi; `RC_QUEUE` + dropdown saran berfungsi; mode `command` mengabaikan teks.
