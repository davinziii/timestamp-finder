"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipSpec } from "@/lib/clip";

export type LocalDownloads =
  | { status: "checking" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; folder: string; version: string; encoder: string };

export type DownloadState =
  | { status: "queued" }
  | { status: "running"; message: string; percent: number | null }
  | { status: "done"; file: string; sizeBytes: number }
  | { status: "error"; message: string };

type ServerEvent =
  | { type: "status"; message: string }
  | { type: "progress"; percent: number }
  | { type: "done"; file: string; sizeBytes: number }
  | { type: "error"; message: string };

/** Whether this app can save clips to disk (only when running locally with yt-dlp). */
export function useLocalDownloads(): LocalDownloads {
  const [state, setState] = useState<LocalDownloads>({ status: "checking" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clip", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { enabled: boolean; reason?: string; folder?: string; version?: string; encoder?: string }) => {
        if (cancelled) return;
        setState(
          d.enabled
            ? { status: "ready", folder: d.folder ?? "", version: d.version ?? "", encoder: d.encoder ?? "libx264" }
            : { status: "unavailable", reason: d.reason ?? "Downloads aren't available here." },
        );
      })
      .catch(() => !cancelled && setState({ status: "unavailable", reason: "Downloads aren't available here." }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** Per-sentence download state, keyed by sentence index. */
export function useClipDownloads() {
  const [states, setStates] = useState<Record<number, DownloadState>>({});
  const controllers = useRef(new Map<number, AbortController>());

  const set = useCallback(
    (key: number, s: DownloadState) => setStates((prev) => ({ ...prev, [key]: s })),
    [],
  );

  const download = useCallback(
    async (key: number, spec: ClipSpec): Promise<void> => {
      controllers.current.get(key)?.abort();
      const controller = new AbortController();
      controllers.current.set(key, controller);
      set(key, { status: "running", message: "Starting…", percent: null });
      try {
        const res = await fetch("/api/clip", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(spec),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const d = (await res.json().catch(() => null)) as { reason?: string } | null;
          set(key, { status: "error", message: d?.reason ?? `Download failed (${res.status}).` });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let last: DownloadState = { status: "running", message: "Starting…", percent: null };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line) as ServerEvent;
            if (ev.type === "status") {
              last = { status: "running", message: ev.message, percent: last.status === "running" ? last.percent : null };
            } else if (ev.type === "progress") {
              last = { status: "running", message: "Downloading clip…", percent: ev.percent };
            } else if (ev.type === "done") {
              last = { status: "done", file: ev.file, sizeBytes: ev.sizeBytes };
            } else {
              last = { status: "error", message: ev.message };
            }
            set(key, last);
          }
        }
        if (last.status === "running") set(key, { status: "error", message: "The download stopped unexpectedly." });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setStates((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } else {
          set(key, { status: "error", message: "Couldn't reach the app server." });
        }
      } finally {
        if (controllers.current.get(key) === controller) controllers.current.delete(key);
      }
    },
    [set],
  );

  const cancel = useCallback((key: number) => controllers.current.get(key)?.abort(), []);

  const queue = useCallback((keys: number[]) => {
    setStates((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = { status: "queued" };
      return next;
    });
  }, []);

  // Stop any running downloads when the results go away.
  useEffect(() => {
    const map = controllers.current;
    return () => map.forEach((c) => c.abort());
  }, []);

  return { states, download, cancel, queue };
}

export async function revealClip(file: string) {
  await fetch("/api/clip/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).catch(() => {});
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}
