const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

/**
 * Extracts the 11-character video ID from any common YouTube URL form
 * (watch, youtu.be, shorts, live, embed). Returns null for anything else.
 */
export function extractVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null;
  } else if (url.pathname === "/watch") {
    candidate = url.searchParams.get("v");
  } else {
    const m = url.pathname.match(/^\/(?:shorts|live|embed|v|e)\/([^/?#]+)/);
    candidate = m?.[1] ?? null;
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** Link that opens the video at the given second. */
export function buildTimestampUrl(videoId: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `https://www.youtube.com/watch?v=${videoId}&t=${t}s`;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
