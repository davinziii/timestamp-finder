# ClipFinder

Find the best moments, locate exact timestamps, and prepare clips from YouTube videos. Built for clippers working with 1–3 hour videos. Two tools:

- **Timestamp Finder** (`/`): paste a video and the lines you're looking for, and get a timestamp for every one.
- **Best Moments** (`/best-moments`): paste a video, pick a moment type, and get a ranked list of moments worth clipping.

The video URL is shared between the two tools (per browser tab), and each video's transcript is fetched once and shared by both (`getTranscript()` caches it for an hour, and concurrent requests share one fetch). Every clip, whether a search result, the trim panel or a Best Moments card, uses the same `ClipEditor`: name, start/end with the same validation everywhere, an inline **Preview clip** player that plays exactly that range, copyable command, and download.

```bash
npm install
npm run dev        # http://localhost:3000
```

There are no API keys, database, accounts, or AI services. See `.env.example`.

## Best Moments

`POST /api/moments {url, type, count}` streams NDJSON like the search route. There is no AI model: moments are scored from what can be read reliably, and every source reports whether it was used, empty, or unavailable.

| Source | How | Used for |
| --- | --- | --- |
| Transcript (required) | the same Innertube captions as the Timestamp Finder (`getTranscript`) | cue phrases per category, pauses (clip boundaries), captioned `[Laughter]`/`[Applause]`, speaker changes, hooks |
| Title & description | the player response | topic relevance, fallback chapters |
| Chapters | watch-page data (`/youtubei/v1/next`), else description timestamps | topic labels, penalty for clips that cross a chapter, skipping sponsor chapters |
| Top comments | first 3 pages (~60) of top comments, same endpoint | `12:40 😂`-style timestamps and quoted lines, weighted by likes; a supporting signal only |
| Most replayed | the heatmap in the watch-page data | a supporting signal; the intro is ignored |
| Video/audio | not analyzed | visual-only moments can be missed (the UI says so) |

Pipeline (`lib/moments/`): words → utterance units split at pauses → a candidate window for every natural start, ending at a pause within the type's length range → per-category scores (`lexicon.ts`) plus viewer signals and boundary quality → windows without enough evidence are dropped → greedy non-overlapping pick (All Types also spreads across categories). Fewer moments than requested are returned rather than padding with weak ones. Titles are keyword summaries (tf-idf against the whole video), never presented as quotes. `scoreText()` in `lexicon.ts` is the piece to replace with an AI model later. Results link to the video at the start second, copy in bulk, download with the same yt-dlp workflow, and open in the Timestamp Finder (`/?url=&q=&start=&end=`).

## How it works

```
YouTube URL ─▶ extractVideoId ─▶ Innertube player API (ANDROID, then IOS client)
           ─▶ caption track (auto-generated first, then creator) as json3
           ─▶ word-level timings ─▶ normalize + index (transcript and index cached in memory 1h)
sentences  ─▶ candidate regions via inverted index ─▶ fuzzy word alignment ─▶ rank/dedupe
           ─▶ timestamp + https://www.youtube.com/watch?v=ID&t=SECONDSs
```

- **Transcript retrieval** (`lib/transcript.ts`): the caption URLs YouTube gives the WEB client need a proof-of-origin token and come back as *empty 200s*. The ANDROID/IOS player responses return caption URLs that can be fetched server-side, and auto-generated tracks include **per-word timing**, so a match lands on the first word, not the start of a 4-second cue. An empty or blocked response is reported as "couldn't access a transcript", never as "no captions". Providers are a list, so an audio-transcription fallback can be appended later.
- **Matching** (`lib/normalize.ts`, `lib/fuzzyMatch.ts`, `lib/search.ts`):
  1. **Normalization.** Case, punctuation, apostrophes, hyphens, `$1,000`, "twenty one" → 21, and light stemming are handled.
  2. **Fuzzy matching.** A semi-global word alignment tolerates missing or extra words, typos, plurals, and compounds ("overtrading" ≈ "over-trading"). Alignment runs over words, not caption cues, so sentences that span several segments match naturally.
  3. **Semantic matching** isn't built. Add a `Matcher` to `findCandidates` and its candidates are ranked with the fuzzy ones.
- **Streaming API** (`app/api/search/route.ts`): `POST {url, sentences}` returns NDJSON events (real stages, video info, results). The transcript never leaves the server.
- Limits and thresholds live in `lib/config.ts`: 50 sentences, found ≥ 50%, "strong" ≥ 75%.

## Clip downloads

The **Download or trim this video** panel under the search form takes any start/end (validated: end after start, inside the video, at most 15 minutes) and downloads only that range, or downloads the **full video** as-is (no re-encode, no length limit). Every result has a **clip name**, an adjustable **start/end**, and two ways to get the clip:

- **Copy download command** (and **Copy all download commands**): a `yt-dlp` command that works in PowerShell, cmd and bash. It downloads only that time range and saves it to `~/Videos/clips/<name>.mp4`. This works anywhere, including on a deployed site.
- **Download clip** (and **Download all clips**): when the app runs on your computer with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg installed, it runs yt-dlp for you, shows real progress, and saves to `~/Videos/clips`. Existing files are never overwritten (`name (2).mp4`), and Cancel stops yt-dlp and ffmpeg and removes the partial file.

Every clip is re-encoded to H.264 + AAC (CRF 18, visually lossless, yuv420p) with a keyframe at the exact start. Copying YouTube's stream without re-encoding can only start on one of its keyframes, which are seconds apart. A copied clip therefore starts mid-GOP, which shows up as smeared or blocky video and audio drifting out of sync in players and editors. Clips default to 1 minute from the matched timestamp (`DEFAULT_CLIP_SECONDS` in `lib/clip.ts`); edit the end to change it. Resolution is set globally and can be overridden per clip. The higher option is labelled with what the video really offers (for example "4K" or "1440p") and is hidden when the video tops out at 1080p. There are two resolution options:

- **Up to 1080p** (default): fast (about 3× the clip length on a 12-thread CPU).
- **Best (up to 4K)**: the highest resolution YouTube has. 4K encoding takes about 10× the clip length on the CPU.

NVIDIA hardware encoding (NVENC) is detected automatically with a test encode and used when it works, which makes 4K much faster. Set `FFMPEG_PATH` if ffmpeg isn't on your PATH.

Local downloads are only on in `npm run dev` or with `ENABLE_LOCAL_DOWNLOADS=true`. They only answer requests addressed to localhost from a localhost page, and are never enabled on Vercel (see `lib/localDownload.ts` and `.env.example`). YouTube's terms restrict downloading, so only clip videos you have permission to use (for example, through creator clipping programs).

## Tests

```bash
npm test                                   # offline: spec examples, URL parsing, sentence splitting, timestamps
npm run test:accuracy -- L_Guz73e6fw 25    # real video: creator captions as the "script", searched in ASR, vs true time
npm run test:robustness -- L_Guz73e6fw     # perturbed lines (dropped/extra/synonym/typo words) and decoys
npm run test:moments -- L_Guz73e6fw 10 -v  # Best Moments for every type on a real video, with invariant checks
```

## Known limitations

- YouTube may block transcript requests from datacenter IPs (some cloud hosts). Locally this works reliably. If a deployment gets blocked, add a proxy or a paid transcript provider as another entry in `PROVIDERS`.
- Matching is lexical. A line paraphrased with entirely different words won't be found until semantic search is added.
- Videos without any captions report "Transcript unavailable". Automatic transcription is deliberately not implemented.
