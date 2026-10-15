"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/*
 * Previews talk to the YouTube embed API (enablejsapi=1, postMessage):
 *
 *   - Only one plays at a time: when one starts playing (opened or resumed),
 *     the other open previews pause and keep their position.
 *   - The clip range is enforced here, not with the embed's start/end URL
 *     parameters, so editing the times doesn't reload the player: a new end
 *     takes effect as it plays, a new start seeks once typing settles.
 */

interface PlayerState {
  start: number;
  end: number;
  playing: boolean;
  /** Paused by us at the clip end; pressing play again replays from the start. */
  atEnd: boolean;
}

const players = new Map<HTMLIFrameElement, PlayerState>();
let listening = false;

function command(iframe: HTMLIFrameElement, func: string, args: unknown[] = []) {
  iframe.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), EMBED_ORIGIN);
}

function pauseOthers(playing: HTMLIFrameElement) {
  for (const p of players.keys()) if (p !== playing) command(p, "pauseVideo");
}

/** Asks a player to report its state and time to this page. */
function subscribe(iframe: HTMLIFrameElement) {
  iframe.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: iframe.id, channel: "widget" }), EMBED_ORIGIN);
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (e) => {
    if (e.origin !== EMBED_ORIGIN || typeof e.data !== "string") return;
    let data: { event?: string; info?: unknown };
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    const iframe = [...players.keys()].find((p) => p.contentWindow === e.source);
    if (!iframe) return;
    const p = players.get(iframe)!;

    const info = (data.event === "infoDelivery" ? data.info : undefined) as
      | { playerState?: number; currentTime?: number }
      | undefined;
    const state = data.event === "onStateChange" ? (data.info as number) : info?.playerState;
    if (state !== undefined) {
      const wasPlaying = p.playing;
      p.playing = state === 1;
      // 1 = playing: this one started, so the others pause.
      if (p.playing && !wasPlaying) pauseOthers(iframe);
    }

    const t = info?.currentTime;
    if (t === undefined || !p.playing) return;
    if (t >= p.end) {
      if (p.atEnd) {
        // Played again after stopping at the end: replay the clip.
        p.atEnd = false;
        command(iframe, "seekTo", [p.start, true]);
      } else {
        p.atEnd = true;
        command(iframe, "pauseVideo");
      }
    } else if (t < p.end - 0.5) {
      p.atEnd = false;
    }
  });
}

/** Applies a new clip end to a player (checked as it plays). */
function setEnd(iframe: HTMLIFrameElement, end: number) {
  const p = players.get(iframe);
  if (!p) return;
  p.end = end;
  p.atEnd = false;
}

/** Moves a player to a new clip start and plays from there. */
function seekToStart(iframe: HTMLIFrameElement, start: number) {
  const p = players.get(iframe);
  if (!p) return;
  p.start = start;
  p.atEnd = false;
  command(iframe, "seekTo", [start, true]);
  command(iframe, "playVideo");
}

let nextId = 0;
/** How long the start time must stay unchanged before the player seeks to it. */
const SEEK_DELAY_MS = 700;

/**
 * Plays a clip's range in an embedded player (privacy-enhanced
 * youtube-nocookie), so a range can be checked without leaving the page.
 * Rendered only when opened, so results don't load a player each.
 */
export function ClipPreview({ videoId, start, end }: { videoId: string; start: number; end: number }) {
  // The player loads once at the initial start; later changes go through the API.
  const [initialStart] = useState(() => Math.floor(start));
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const range = useRef({ start: Math.floor(start), end: Math.ceil(end) });

  const params = new URLSearchParams({
    start: String(initialStart),
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    ...(typeof window !== "undefined" ? { origin: window.location.origin } : {}),
  });

  // Stable, so re-renders don't re-register (and re-pause the others).
  const register = useCallback((iframe: HTMLIFrameElement | null) => {
    if (!iframe) return;
    listen();
    iframeRef.current = iframe;
    iframe.id ||= `clip-preview-${++nextId}`;
    players.set(iframe, { ...range.current, playing: false, atEnd: false });
    // A newly opened preview autoplays: pause the rest right away.
    pauseOthers(iframe);
    const onLoad = () => subscribe(iframe);
    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      players.delete(iframe);
      if (iframeRef.current === iframe) iframeRef.current = null;
    };
  }, []);

  // A new end applies immediately (checked as the clip plays): no reload, no restart.
  useEffect(() => {
    range.current.end = Math.ceil(end);
    if (iframeRef.current) setEnd(iframeRef.current, Math.ceil(end));
  }, [end]);

  // A new start seeks once it stops changing, so typing "2:19:40" doesn't jump at every digit.
  useEffect(() => {
    const s = Math.floor(start);
    if (s === range.current.start) return;
    const timer = setTimeout(() => {
      range.current.start = s;
      if (iframeRef.current) seekToStart(iframeRef.current, s);
    }, SEEK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [start]);

  return (
    <div className="animate-rise mt-3 aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
      <iframe
        ref={register}
        src={`${EMBED_ORIGIN}/embed/${videoId}?${params}`}
        title="Clip preview"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        className="size-full"
      />
    </div>
  );
}

/**
 * The range to preview: the latest valid one. While a time is half-typed
 * (invalid), the preview keeps the last valid range instead of jumping to a
 * fallback and back.
 */
export function useLastValidRange<F extends { start: number; end: number } | null>(
  range: { start: number; end: number } | null,
  fallback: F,
): { start: number; end: number } | F {
  const [last, setLast] = useState<{ start: number; end: number } | F>(range ?? fallback);
  if (range && (!last || range.start !== last.start || range.end !== last.end)) {
    setLast(range);
    return range;
  }
  return last;
}
