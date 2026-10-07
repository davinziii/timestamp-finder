import { TRANSCRIPT_CACHE } from "./config";
import { thumbnailUrl } from "./youtube";
import type {
  Transcript,
  TranscriptSegment,
  TranscriptSource,
  TranscriptWord,
  VideoInfo,
} from "@/types/transcript";

/*
 * Transcript retrieval.
 *
 * Providers are tried in order until one returns a transcript. Today there is
 * one provider (YouTube's Innertube player API). A future audio-transcription
 * or uploaded-file provider can be appended to PROVIDERS without touching the
 * search code.
 *
 * Why Innertube with mobile clients: the timedtext URLs YouTube hands to the
 * WEB client require a proof-of-origin token and come back as empty 200
 * responses without it. The ANDROID / IOS player responses return caption URLs
 * that are fetchable server-side, including word-level timing for
 * auto-generated captions (json3 format).
 */

export type TranscriptErrorCode = "VIDEO_UNAVAILABLE" | "NO_CAPTIONS" | "TRANSCRIPT_UNAVAILABLE";

export class TranscriptError extends Error {
  constructor(
    public code: TranscriptErrorCode,
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

interface TranscriptProvider {
  name: string;
  fetch(videoId: string): Promise<Transcript>;
}

// ---------------------------------------------------------------------------
// Innertube provider

interface InnertubeClient {
  name: string;
  context: Record<string, unknown>;
  userAgent: string;
}

const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    name: "ANDROID",
    context: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34 },
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
  },
  {
    name: "IOS",
    context: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2" },
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)",
  },
];

const REQUEST_TIMEOUT_MS = 15_000;

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  streamingData?: { adaptiveFormats?: { width?: number; height?: number }[] };
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string; tOffsetMs?: number }[];
}

type Attempt =
  | { kind: "unavailable"; reason: string }
  | { kind: "no-captions" }
  | { kind: "access"; reason: string };

async function fetchPlayer(videoId: string, client: InnertubeClient): Promise<PlayerResponse> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": client.userAgent },
    body: JSON.stringify({
      context: { client: { ...client.context, hl: "en", gl: "US" } },
      videoId,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`player HTTP ${res.status}`);
  return (await res.json()) as PlayerResponse;
}

/**
 * Track preference: auto-generated (spoken language, word timings) first,
 * then creator captions, English before other languages.
 */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  const rank = (t: CaptionTrack) =>
    (t.kind === "asr" ? 0 : 10) + (t.languageCode.startsWith("en") ? 0 : 1);
  return [...tracks].sort((a, b) => rank(a) - rank(b))[0];
}

async function fetchJson3(track: CaptionTrack, client: InnertubeClient): Promise<Json3Event[]> {
  const url = track.baseUrl.replace(/&fmt=[^&]*/g, "") + "&fmt=json3";
  const res = await fetch(url, {
    headers: { "user-agent": client.userAgent },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`timedtext HTTP ${res.status}`);
  const body = await res.text();
  // An empty 200 means YouTube refused the request (e.g. missing PO token),
  // not that the captions are empty.
  if (!body.trim()) throw new Error("timedtext returned an empty response");
  const data = JSON.parse(body) as { events?: Json3Event[] };
  const events = (data.events ?? []).filter((e) => e.segs?.length);
  if (!events.length) throw new Error("timedtext contained no caption events");
  return events;
}

const innertubeProvider: TranscriptProvider = {
  name: "youtube-innertube",
  async fetch(videoId) {
    const attempts: Attempt[] = [];

    for (const client of INNERTUBE_CLIENTS) {
      let player: PlayerResponse;
      try {
        player = await fetchPlayer(videoId, client);
      } catch (e) {
        attempts.push({ kind: "access", reason: `${client.name}: ${(e as Error).message}` });
        continue;
      }

      const status = player.playabilityStatus?.status;
      const reason = player.playabilityStatus?.reason ?? status ?? "unknown";
      if (status === "ERROR") {
        attempts.push({ kind: "unavailable", reason });
        continue;
      }
      if (status !== "OK") {
        // LOGIN_REQUIRED (bot check, age gate), UNPLAYABLE, LIVE_STREAM_OFFLINE…
        attempts.push({ kind: "access", reason: `${client.name}: ${reason}` });
        continue;
      }

      const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      if (!tracks.length) {
        attempts.push({ kind: "no-captions" });
        continue;
      }

      const track = pickTrack(tracks);
      let events: Json3Event[];
      try {
        events = await fetchJson3(track, client);
      } catch (e) {
        attempts.push({ kind: "access", reason: `${client.name}: ${(e as Error).message}` });
        continue;
      }

      const video: VideoInfo = {
        videoId,
        title: player.videoDetails?.title ?? "Untitled video",
        author: player.videoDetails?.author ?? "",
        durationSeconds: Number(player.videoDetails?.lengthSeconds ?? 0),
        thumbnailUrl: thumbnailUrl(videoId),
        maxHeight: maxResolution(player),
      };
      const source: TranscriptSource = track.kind === "asr" ? "youtube-asr" : "youtube-captions";
      return buildTranscript(video, source, track.languageCode, events);
    }

    throw classifyFailure(attempts);
  },
};

/** Short side of the largest video format, so vertical videos read as 1080p, not 1920p. */
function maxResolution(player: PlayerResponse): number {
  let max = 0;
  for (const f of player.streamingData?.adaptiveFormats ?? []) {
    if (f.width && f.height) max = Math.max(max, Math.min(f.width, f.height));
  }
  return max;
}

function classifyFailure(attempts: Attempt[]): TranscriptError {
  const detail = attempts
    .map((a) => (a.kind === "no-captions" ? "no caption tracks listed" : a.reason))
    .join("; ");

  if (attempts.length && attempts.every((a) => a.kind === "unavailable")) {
    return new TranscriptError(
      "VIDEO_UNAVAILABLE",
      "This video is unavailable. It may be private, deleted, or region-locked.",
      detail,
    );
  }
  // Only claim "no captions" when YouTube answered normally and simply listed none.
  if (attempts.length && attempts.every((a) => a.kind === "no-captions")) {
    return new TranscriptError(
      "NO_CAPTIONS",
      "This video doesn't have any captions available, so there is no transcript to search.",
      detail,
    );
  }
  return new TranscriptError(
    "TRANSCRIPT_UNAVAILABLE",
    "We couldn't access a transcript for this video. The video may not have accessible captions, or YouTube may be preventing transcript access.",
    detail,
  );
}

// ---------------------------------------------------------------------------
// json3 -> segments + words

/** Sound annotations like [Music] or (applause) aren't speech. */
const ANNOTATION = /\[[^\]]*\]|\([^)]*\)/g;

function buildTranscript(
  video: VideoInfo,
  source: TranscriptSource,
  language: string,
  events: Json3Event[],
): Transcript {
  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];
  const wordTimings = source === "youtube-asr";

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const startMs = ev.tStartMs ?? 0;
    const nextStartMs = events[i + 1]?.tStartMs;
    let durMs = ev.dDurationMs ?? 0;
    // Rolling ASR cues overlap; end each cue when the next one starts.
    if (nextStartMs !== undefined && nextStartMs > startMs) durMs = Math.min(durMs || Infinity, nextStartMs - startMs);
    if (!Number.isFinite(durMs) || durMs <= 0) durMs = 2000;

    const segs = ev.segs ?? [];
    const text = segs.map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    segments.push({ start: startMs / 1000, duration: durMs / 1000, text });

    if (wordTimings) {
      // Each seg is a word (or a few) with its own offset into the cue.
      for (let j = 0; j < segs.length; j++) {
        const segStart = startMs + (segs[j].tOffsetMs ?? 0);
        const segEnd =
          j + 1 < segs.length ? startMs + (segs[j + 1].tOffsetMs ?? 0) : startMs + durMs;
        pushWords(words, segs[j].utf8 ?? "", segStart, Math.max(segEnd, segStart + 100));
      }
    } else {
      pushWords(words, text, startMs, startMs + durMs);
    }
  }

  return { video, source, language, wordTimings, segments, words };
}

/** Splits text into words and spreads the time span across them by length. */
function pushWords(out: TranscriptWord[], text: string, startMs: number, endMs: number) {
  const parts = text.replace(ANNOTATION, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  const totalChars = parts.reduce((n, p) => n + p.length + 1, 0);
  const span = endMs - startMs;
  let cursor = 0;
  for (const p of parts) {
    const s = startMs + (span * cursor) / totalChars;
    cursor += p.length + 1;
    const e = startMs + (span * cursor) / totalChars;
    out.push({ text: p, start: s / 1000, end: e / 1000 });
  }
}

// ---------------------------------------------------------------------------
// Public API with a small in-memory cache (no database, per spec).

const PROVIDERS: TranscriptProvider[] = [innertubeProvider];

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const globalCache = globalThis as unknown as {
  __transcriptCache?: Map<string, CacheEntry<unknown>>;
};
const cache = (globalCache.__transcriptCache ??= new Map());

/** Returns the cached value for a video, computing (and caching) it on miss. */
export async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, hit);
    return hit.value as T;
  }
  const value = await compute();
  cache.set(key, { value, expires: Date.now() + TRANSCRIPT_CACHE.ttlMs });
  while (cache.size > TRANSCRIPT_CACHE.maxEntries) {
    cache.delete(cache.keys().next().value!);
  }
  return value;
}

export function isCached(key: string): boolean {
  const hit = cache.get(key);
  return !!hit && hit.expires > Date.now();
}

export async function getTranscript(videoId: string): Promise<Transcript> {
  let lastError: TranscriptError | null = null;
  for (const provider of PROVIDERS) {
    try {
      return await provider.fetch(videoId);
    } catch (e) {
      lastError =
        e instanceof TranscriptError
          ? e
          : new TranscriptError("TRANSCRIPT_UNAVAILABLE", "We couldn't access a transcript for this video.", String(e));
      // A video that doesn't exist won't be found by any other provider either.
      if (lastError.code === "VIDEO_UNAVAILABLE") break;
    }
  }
  throw lastError ?? new TranscriptError("TRANSCRIPT_UNAVAILABLE", "No transcript provider is configured.");
}
