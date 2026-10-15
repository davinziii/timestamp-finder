"use client";

import { useCallback } from "react";

const EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/*
 * Only one preview plays at a time. Each player reports its state through the
 * YouTube embed API (enablejsapi=1, postMessage); when one starts playing,
 * every other open preview on the page is paused (and stays where it was).
 */
const players = new Set<HTMLIFrameElement>();
let listening = false;

function command(iframe: HTMLIFrameElement, func: string) {
  iframe.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), EMBED_ORIGIN);
}

function pauseOthers(playing: HTMLIFrameElement) {
  for (const p of players) if (p !== playing) command(p, "pauseVideo");
}

/** Asks a player to send its state changes to this page. */
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
    // State 1 = playing. It arrives as onStateChange, or inside infoDelivery.
    const state =
      data.event === "onStateChange"
        ? data.info
        : data.event === "infoDelivery"
          ? (data.info as { playerState?: number } | undefined)?.playerState
          : undefined;
    if (state !== 1) return;
    for (const p of players) if (p.contentWindow === e.source) pauseOthers(p);
  });
}

let nextId = 0;

/**
 * Plays exactly a clip's range in an embedded player (privacy-enhanced
 * youtube-nocookie), so a range can be checked without leaving the page.
 * Rendered only when opened, so results don't load a player each.
 */
export function ClipPreview({ videoId, start, end }: { videoId: string; start: number; end: number }) {
  const params = new URLSearchParams({
    start: String(Math.floor(start)),
    end: String(Math.ceil(end)),
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    ...(typeof window !== "undefined" ? { origin: window.location.origin } : {}),
  });

  // Stable, so re-renders don't re-register (and re-pause the others); a new range remounts the iframe.
  const register = useCallback((iframe: HTMLIFrameElement | null) => {
    if (!iframe) return;
    listen();
    iframe.id ||= `clip-preview-${++nextId}`;
    players.add(iframe);
    // A newly opened preview autoplays: pause the rest right away.
    pauseOthers(iframe);
    const onLoad = () => subscribe(iframe);
    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      players.delete(iframe);
    };
  }, []);

  return (
    <div className="animate-rise mt-3 aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
      <iframe
        // Changing the range reloads the player at the new start.
        key={`${start}-${end}`}
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
