import { TranscriptError } from "./transcript";
import type { ErrorCode } from "@/types/search";
import type { Transcript } from "@/types/transcript";

/*
 * Server helpers shared by the streaming API routes (/api/search,
 * /api/moments): newline-delimited JSON responses and the error events they
 * end with.
 */

export interface ErrorEvent {
  type: "error";
  code: ErrorCode;
  message: string;
  detail?: string;
}

/** Streams the events `run` sends as NDJSON, one JSON object per line. */
export function ndjsonResponse<E>(run: (send: (event: E) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: E) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The client went away.
        }
      };
      try {
        await run(send);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** A JSON error response for requests rejected before streaming starts. */
export function errorResponse(code: ErrorCode, message: string, status = 400): Response {
  return Response.json({ type: "error", code, message } satisfies ErrorEvent, { status });
}

/** Turns anything thrown while handling a video into the error event the UI shows. */
export function errorEvent(e: unknown, route: string, videoId: string, fallback: string): ErrorEvent {
  if (e instanceof TranscriptError) {
    console.warn(`[${route}] ${videoId}: ${e.code} — ${e.detail ?? e.message}`);
    return { type: "error", code: e.code, message: e.message, detail: e.detail };
  }
  console.error(`[${route}] ${videoId}:`, e);
  return { type: "error", code: "INTERNAL", message: fallback };
}

/**
 * Music-only videos can have an auto-caption track that is nothing but [Music]
 * (plus the odd hallucinated word). Real speech is ~2–3 words per second.
 */
export function lacksSpeech(transcript: Transcript): boolean {
  const n = transcript.words.length;
  return n < 20 && n < transcript.video.durationSeconds / 10;
}
