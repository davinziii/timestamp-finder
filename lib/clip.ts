import { formatTimestamp, parseTimestamp } from "./timestamp";

/*
 * Clip download helpers shared by the browser (copyable yt-dlp commands) and
 * the local-only download route (which spawns yt-dlp with the same arguments).
 */

/*
 * Every clip is re-encoded. Copying YouTube's stream without re-encoding can
 * only start on one of its keyframes (seconds apart), so a copied clip begins
 * mid-GOP: smeared/blocky video and players drifting out of sync. Re-encoding
 * gives a real keyframe at the exact start, H.264 that every editor opens, and
 * at CRF 18 it is visually indistinguishable from the source.
 */
export type ClipQuality = "1080" | "best";

export const CLIP_QUALITY_LABELS: Record<ClipQuality, { label: string; hint: string }> = {
  "1080": {
    label: "Up to 1080p",
    hint: "Full HD H.264. Fast, and the right size for social clips.",
  },
  best: {
    label: "Best (up to 4K)",
    hint: "Highest resolution YouTube has. 4K takes several minutes per minute of video to encode.",
  },
};

/** 2160 -> "4K", 1440 -> "1440p", 4320 -> "8K". */
export function resolutionLabel(p: number): string {
  if (p >= 4320) return "8K";
  if (p >= 2160) return "4K";
  return `${p}p`;
}

/** Whether "best" can be better than 1080p for a video (unknown counts as yes). */
export function offersAbove1080(maxHeight: number): boolean {
  return !maxHeight || maxHeight > 1080;
}

export type VideoEncoder = "libx264" | "h264_nvenc";

/** ffmpeg output options: frame-exact H.264 + AAC that plays everywhere. */
export function encodeArgs(encoder: VideoEncoder = "libx264"): string {
  const video =
    encoder === "h264_nvenc"
      ? "-c:v h264_nvenc -preset p6 -tune hq -rc vbr -cq 19 -b:v 0"
      : "-c:v libx264 -crf 18 -preset fast";
  // yuv420p: YouTube's 4K/HDR streams can be 10-bit, which many players and editors reject in H.264.
  return `${video} -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart`;
}

/** New clips run this long from the matched timestamp; the user can change the end. */
export const DEFAULT_CLIP_SECONDS = 60;

export const CLIP_LIMITS = {
  maxDurationSeconds: 15 * 60,
  maxNameLength: 80,
} as const;

/** Default folder shown in copied commands; yt-dlp expands "~" on every OS. */
export const DEFAULT_CLIPS_PATH = "~/Videos/clips";

/**
 * Makes a name safe as a filename AND inside a double-quoted shell argument
 * (PowerShell, cmd and bash): no path separators, quotes, $, backticks, % or !.
 */
export function sanitizeClipName(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _\-.,()[\]'+#&]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, CLIP_LIMITS.maxNameLength)
    .trim();
  // Windows reserves these device names.
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return "clip";
  return cleaned;
}

/** "03 - It takes two or three years" */
export function defaultClipName(index: number, query: string): string {
  const words = query.replace(/[^\p{L}\p{N}' ]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 7);
  return sanitizeClipName(`${String(index + 1).padStart(2, "0")} - ${words.join(" ")}`);
}

export interface ClipSpec {
  videoId: string;
  start: number; // seconds
  end: number; // seconds
  name: string;
  quality: ClipQuality;
  /** Download the whole video as-is (start/end ignored, no re-encode). */
  full?: boolean;
}

export function validateClip(spec: ClipSpec): string | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(spec.videoId)) return "Invalid video.";
  if (spec.full) return null;
  if (!Number.isFinite(spec.start) || !Number.isFinite(spec.end) || spec.start < 0) return "Invalid clip range.";
  if (spec.end <= spec.start) return "The clip end must be after the start.";
  if (spec.end - spec.start > CLIP_LIMITS.maxDurationSeconds) {
    return `Clips can be at most ${CLIP_LIMITS.maxDurationSeconds / 60} minutes long.`;
  }
  return null;
}

/** A clip as the user edits it: times are text until they parse. */
export interface ClipDraft {
  name: string;
  start: string;
  end: string;
  /** This clip's own resolution; undefined = follow the default. */
  quality?: ClipQuality;
}

export interface RangeError {
  field: "start" | "end";
  message: string;
}

/**
 * Checks a typed start/end pair. Empty fields aren't errors yet (still being
 * typed). Negative times never parse, so they are reported as invalid times.
 * durationSeconds = 0 means the video length is unknown.
 */
export function checkRange(start: string, end: string, durationSeconds = 0): RangeError | null {
  const s = parseTimestamp(start);
  const e = parseTimestamp(end);
  if (start.trim() && s === null) return { field: "start", message: "Enter the start as a time, like 1:30 or 1:02:30." };
  if (end.trim() && e === null) return { field: "end", message: "Enter the end as a time, like 2:30 or 1:04:00." };
  if (s === null || e === null) return null;
  if (durationSeconds > 0 && s >= durationSeconds) {
    return { field: "start", message: `The video is only ${formatTimestamp(durationSeconds)} long.` };
  }
  if (e <= s) return { field: "end", message: "The end time must be later than the start time." };
  if (durationSeconds > 0 && e > durationSeconds + 1) {
    return { field: "end", message: `The video ends at ${formatTimestamp(durationSeconds)}.` };
  }
  if (e - s > CLIP_LIMITS.maxDurationSeconds) {
    return { field: "end", message: `Clips can be at most ${CLIP_LIMITS.maxDurationSeconds / 60} minutes long.` };
  }
  return null;
}

/** The downloadable clip for a draft, or null while it is incomplete or invalid. */
export function draftToSpec(
  videoId: string,
  d: ClipDraft,
  quality: ClipQuality,
  durationSeconds = 0,
  fallbackName = "clip",
): ClipSpec | null {
  const start = parseTimestamp(d.start);
  const end = parseTimestamp(d.end);
  if (start === null || end === null || checkRange(d.start, d.end, durationSeconds)) return null;
  const spec = { videoId, start, end, name: d.name.trim() || fallbackName, quality };
  return validateClip(spec) ? null : spec;
}

/** yt-dlp arguments (without the output location). */
export function ytDlpArgs(spec: ClipSpec, encoder: VideoEncoder = "libx264"): string[] {
  const res = spec.quality === "1080" ? "res:1080" : "res";
  if (spec.full) {
    // The whole video needs no cut, so YouTube's streams are kept as they are
    // (no re-encode): fast, and the original quality.
    return ["--no-playlist", "-S", `${res},proto:m3u8,vcodec:h264,acodec:m4a,ext:mp4`, "--remux-video", "mp4"];
  }
  const section = `*${formatTimestamp(spec.start)}-${formatTimestamp(Math.ceil(spec.end))}`;
  return [
    "--no-playlist",
    "--download-sections",
    section,
    // Highest resolution (capped for "1080") first. At equal resolution prefer
    // HLS (YouTube serves it reliably; direct HTTPS streams sometimes return
    // 403), then H.264 + AAC sources, which decode fastest.
    "-S",
    `${res},proto:m3u8,vcodec:h264,acodec:m4a,ext:mp4`,
    "--force-keyframes-at-cuts",
    "--downloader-args",
    `ffmpeg_o:${encodeArgs(encoder)}`,
    "--remux-video",
    "mp4",
  ];
}

/** A one-line command that works in PowerShell, cmd and bash. */
export function ytDlpCommand(spec: ClipSpec, folder = DEFAULT_CLIPS_PATH): string {
  const quote = (a: string) => (/^[A-Za-z0-9_\-.,:]+$/.test(a) ? a : `"${a}"`);
  const args = [
    ...ytDlpArgs(spec),
    "-P",
    folder,
    "-o",
    `${sanitizeClipName(spec.name)}.%(ext)s`,
    `https://www.youtube.com/watch?v=${spec.videoId}`,
  ];
  return ["yt-dlp", ...args.map(quote)].join(" ");
}
