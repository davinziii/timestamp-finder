import { parseTimestamp } from "../timestamp";

/*
 * Supporting signals for Best Moments, from the same public Innertube API the
 * transcript comes from (the WEB "next" endpoint the watch page itself uses):
 *
 *   - chapters           creator-defined topic boundaries
 *   - heatmap            YouTube's "most replayed" graph (100 buckets)
 *   - comments           the first pages of top comments, with like counts
 *
 * Every signal is optional. Each one reports whether it was used, was
 * genuinely empty, or couldn't be retrieved, and a failure never stops the
 * analysis. Nothing here is scraped from rendered HTML.
 */

export interface Chapter {
  title: string;
  start: number; // seconds
}

export interface HeatMarker {
  start: number; // seconds
  duration: number; // seconds
  intensity: number; // 0–1, normalized by YouTube
}

export interface ViewerComment {
  text: string;
  likes: number;
}

export type Signal<T> =
  | { state: "ok"; value: T }
  | { state: "empty"; reason: string }
  | { state: "unavailable"; reason: string };

export interface Signals {
  chapters: Signal<Chapter[]>;
  heatmap: Signal<HeatMarker[]>;
  comments: Signal<ViewerComment[]>;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WEB_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20250101.00.00", hl: "en", gl: "US" } };
const TIMEOUT_MS = 10_000;
/** Pages of top comments to read (about 20 each). Kept small: it's supplementary evidence. */
const COMMENT_PAGES = 3;

async function next(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ context: WEB_CONTEXT, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`next HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// Innertube responses are deeply nested and loosely typed; walk them defensively.
type Json = unknown;
function get(o: Json, ...path: (string | number)[]): Json {
  let cur = o;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, Json>)[p];
  }
  return cur;
}
const arr = (o: Json): Json[] => (Array.isArray(o) ? o : []);

/** Finds every value stored under `key`, anywhere in the tree. */
function findAll(o: Json, key: string, out: Json[] = [], depth = 0): Json[] {
  if (depth > 40 || o === null || typeof o !== "object") return out;
  if (Array.isArray(o)) {
    for (const v of o) findAll(v, key, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === key) out.push(v);
    findAll(v, key, out, depth + 1);
  }
  return out;
}

export async function getSignals(videoId: string, description: string, durationSeconds: number): Promise<Signals> {
  let watch: Record<string, unknown> | null = null;
  let watchError = "";
  try {
    watch = await next({ videoId });
  } catch (e) {
    watchError = (e as Error).message;
  }

  const chapters = watch ? chaptersFrom(watch, description) : chaptersFromDescription(description, durationSeconds);
  const heatmap: Signal<HeatMarker[]> = watch
    ? heatmapFrom(watch)
    : { state: "unavailable", reason: `Couldn't load the watch data (${watchError}).` };
  const comments: Signal<ViewerComment[]> = watch
    ? await commentsFrom(watch).catch((e: Error) => ({ state: "unavailable" as const, reason: e.message }))
    : { state: "unavailable", reason: `Couldn't load the watch data (${watchError}).` };

  return { chapters, heatmap, comments };
}

// ---------------------------------------------------------------------------
// Chapters

function chaptersFrom(watch: Json, description: string): Signal<Chapter[]> {
  const markers = arr(
    get(
      watch,
      "playerOverlays",
      "playerOverlayRenderer",
      "decoratedPlayerBarRenderer",
      "decoratedPlayerBarRenderer",
      "playerBar",
      "multiMarkersPlayerBarRenderer",
      "markersMap",
    ),
  );
  const entry = markers.find((m) => get(m, "key") === "DESCRIPTION_CHAPTERS" || get(m, "key") === "AUTO_CHAPTERS");
  const chapters = arr(get(entry, "value", "chapters"))
    .map((c) => ({
      title: String(get(c, "chapterRenderer", "title", "simpleText") ?? "").trim(),
      start: Number(get(c, "chapterRenderer", "timeRangeStartMillis") ?? NaN) / 1000,
    }))
    .filter((c) => c.title && Number.isFinite(c.start));
  if (chapters.length >= 2) return { state: "ok", value: chapters };
  // The player bar omits chapters for some clients; the description is the source of truth anyway.
  return chaptersFromDescription(description, Infinity);
}

/** "0:00 Intro", "12:43 - Why traders lose" lines, in increasing order, starting at 0:00. */
export function chaptersFromDescription(description: string, durationSeconds: number): Signal<Chapter[]> {
  const out: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(/^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|.]?\s*(.+)$/);
    if (!m) continue;
    const t = parseTimestamp(m[1]);
    if (t === null || t > durationSeconds) continue;
    if (out.length && t <= out[out.length - 1].start) continue;
    out.push({ title: m[2].trim().slice(0, 100), start: t });
  }
  if (out.length >= 2 && out[0].start === 0) return { state: "ok", value: out };
  return { state: "empty", reason: "This video has no chapters." };
}

// ---------------------------------------------------------------------------
// Most replayed

function heatmapFrom(watch: Json): Signal<HeatMarker[]> {
  for (const list of findAll(watch, "macroMarkersListEntity")) {
    if (get(list, "markersList", "markerType") !== "MARKER_TYPE_HEATMAP") continue;
    const markers = arr(get(list, "markersList", "markers"))
      .map((m) => ({
        start: Number(get(m, "startMillis")) / 1000,
        duration: Number(get(m, "durationMillis")) / 1000,
        intensity: Number(get(m, "intensityScoreNormalized")),
      }))
      .filter((m) => Number.isFinite(m.start) && m.duration > 0 && Number.isFinite(m.intensity));
    if (markers.length >= 10) return { state: "ok", value: markers };
  }
  // YouTube only publishes the graph once a video has enough views.
  return { state: "empty", reason: "YouTube doesn't show a most-replayed graph for this video." };
}

// ---------------------------------------------------------------------------
// Comments

/** "1.2K" -> 1200, "3" -> 3, "" -> 0 */
export function parseCount(s: string): number {
  const m = s.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

function continuationToken(o: Json): string | null {
  const t = get(o, "continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token");
  return typeof t === "string" ? t : null;
}

async function commentsFrom(watch: Json): Promise<Signal<ViewerComment[]>> {
  const sections = arr(get(watch, "contents", "twoColumnWatchNextResults", "results", "results", "contents"));
  const section = sections
    .map((c) => get(c, "itemSectionRenderer"))
    .find((r) => get(r, "sectionIdentifier") === "comment-item-section");
  let token = section ? continuationToken(arr(get(section, "contents"))[0]) : null;
  if (!token) return { state: "empty", reason: "Comments are turned off or not shown for this video." };

  const comments: ViewerComment[] = [];
  for (let page = 0; page < COMMENT_PAGES && token; page++) {
    const res = await next({ continuation: token });
    token = null;
    for (const m of arr(get(res, "frameworkUpdates", "entityBatchUpdate", "mutations"))) {
      const c = get(m, "payload", "commentEntityPayload");
      const text = get(c, "properties", "content", "content");
      if (typeof text !== "string" || !text.trim()) continue;
      comments.push({ text: text.slice(0, 1000), likes: parseCount(String(get(c, "toolbar", "likeCountNotliked") ?? "")) });
    }
    // The last continuation item of the comment list points at the next page.
    for (const ep of arr(get(res, "onResponseReceivedEndpoints"))) {
      const items = arr(
        get(ep, "reloadContinuationItemsCommand", "continuationItems") ??
          get(ep, "appendContinuationItemsAction", "continuationItems"),
      );
      const t = continuationToken(items[items.length - 1]);
      if (t && items.length > 1) token = t;
    }
  }
  if (!comments.length) return { state: "empty", reason: "No comments were returned." };
  return { state: "ok", value: comments };
}
