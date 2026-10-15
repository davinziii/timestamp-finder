"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { extractVideoId } from "@/lib/youtube";
import type { ErrorCode } from "@/types/search";
import type { TranscriptSource, VideoInfo } from "@/types/transcript";
import type { JobError } from "./ErrorPanel";
import { readNdjson } from "./ndjson";
import type { StatusLine } from "./ProcessingStatus";

export interface LoadedVideo {
  video: VideoInfo;
  source: TranscriptSource;
}

/** Events every streaming tool route sends; each route adds its own "done" (and extras). */
type BaseEvent =
  | { type: "status"; stage: string; message: string }
  | { type: "video"; video: VideoInfo; source: TranscriptSource; language: string }
  | { type: "error"; code: ErrorCode; message: string; detail?: string };

/**
 * Runs one of the streaming analyses (/api/search, /api/moments) and keeps
 * the state both tools show: real status lines, the video, the result or an
 * error. A new run cancels the previous one.
 */
export function useVideoJob<Done extends { type: "done" }, Extra extends { type: string } = never>(
  endpoint: string,
  { describeDone, onExtra }: { describeDone: (done: Done) => string; onExtra?: (event: Extra) => void },
) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusLine[]>([]);
  const [video, setVideo] = useState<LoadedVideo | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [error, setError] = useState<JobError | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  /** Shows a problem found before anything was sent (e.g. no sentences). */
  const fail = useCallback((e: JobError) => {
    setError(e);
    setResult(null);
    setStatus([]);
  }, []);

  const run = useCallback(
    async (body: { url: string } & Record<string, unknown>, firstStatus?: StatusLine): Promise<void> => {
      if (busyRef.current) return;
      const videoId = extractVideoId(body.url);
      if (!videoId) {
        setUrlError(body.url.trim() ? "Please enter a valid YouTube URL." : "Paste a YouTube video URL.");
        return;
      }
      setUrlError(null);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setResult(null);
      setStatus(firstStatus ? [firstStatus] : []);
      setVideo((v) => (v?.video.videoId === videoId ? v : null));
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const ev = (await res.json().catch(() => null)) as BaseEvent | null;
          setStatus([]);
          if (ev?.type === "error") {
            if (ev.code === "INVALID_URL") setUrlError(ev.message);
            else setError(ev);
          } else {
            setError({ code: "INTERNAL", message: `The server responded with an error (${res.status}).` });
          }
          return;
        }

        let finished = false;
        await readNdjson<BaseEvent | Done | Extra>(res, (ev) => {
          if (controller.signal.aborted) return;
          if (ev.type === "status") {
            const e = ev as Extract<BaseEvent, { type: "status" }>;
            setStatus((s) => [...s, { stage: e.stage, message: e.message }]);
          } else if (ev.type === "video") {
            const e = ev as Extract<BaseEvent, { type: "video" }>;
            setVideo({ video: e.video, source: e.source });
          } else if (ev.type === "error") {
            finished = true;
            setError(ev as Extract<BaseEvent, { type: "error" }>);
          } else if (ev.type === "done") {
            finished = true;
            const done = ev as Done;
            setResult(done);
            setStatus((s) => [...s, { stage: "done", message: describeDone(done) }]);
          } else {
            onExtra?.(ev as Extra);
          }
        });
        if (!finished && !controller.signal.aborted) {
          setError({ code: "INTERNAL", message: "The connection closed before the analysis finished." });
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError({ code: "INTERNAL", message: "Couldn't reach the server. Check your connection and try again." });
      } finally {
        if (abortRef.current === controller) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [endpoint, describeDone, onExtra],
  );

  return { busy, status, video, result, error, urlError, setUrlError, run, fail, resultsRef };
}

const URL_KEY = "clipfinder:url";
const urlListeners = new Set<() => void>();
let currentUrl: string | null = null;

function readUrl(): string {
  if (currentUrl === null) {
    try {
      currentUrl = sessionStorage.getItem(URL_KEY) ?? "";
    } catch {
      currentUrl = "";
    }
  }
  return currentUrl;
}

function writeUrl(next: string) {
  currentUrl = next;
  try {
    sessionStorage.setItem(URL_KEY, next);
  } catch {}
  urlListeners.forEach((l) => l());
}

function subscribeUrl(onChange: () => void) {
  urlListeners.add(onChange);
  return () => urlListeners.delete(onChange);
}

/**
 * The video URL, one value shared by both tools (and kept for this browser
 * tab): switching from the Timestamp Finder to Best Moments keeps the video
 * you were working on, in both directions.
 */
export function useSharedUrl(): [string, (url: string) => void] {
  return [useSyncExternalStore(subscribeUrl, readUrl, () => ""), writeUrl];
}
