import { cached, getTranscript, isCached, TranscriptError } from "@/lib/transcript";
import { processTranscript, findCandidates, rankCandidates, type ProcessedTranscript } from "@/lib/search";
import { validateSentences } from "@/lib/sentences";
import { extractVideoId } from "@/lib/youtube";
import type { SearchEvent } from "@/types/search";
import type { Transcript } from "@/types/transcript";

/*
 * POST /api/search  { url: string, sentences: string }
 *
 * Streams newline-delimited JSON (SearchEvent) so the UI can show each real
 * processing stage as it happens. The transcript never leaves the server;
 * only matches are returned.
 */

interface Prepared {
  transcript: Omit<Transcript, "words" | "segments">;
  processed: ProcessedTranscript;
}

export async function POST(request: Request) {
  let body: { url?: unknown; sentences?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ type: "error", code: "INVALID_INPUT", message: "Invalid request." }, { status: 400 });
  }

  const videoId = typeof body.url === "string" ? extractVideoId(body.url) : null;
  if (!videoId) {
    return Response.json(
      { type: "error", code: "INVALID_URL", message: "Please enter a valid YouTube URL." } satisfies SearchEvent,
      { status: 400 },
    );
  }
  const validation = validateSentences(typeof body.sentences === "string" ? body.sentences : "");
  if (!validation.ok) {
    return Response.json(
      { type: "error", code: "INVALID_INPUT", message: validation.message } satisfies SearchEvent,
      { status: 400 },
    );
  }
  const sentences = validation.sentences;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SearchEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const started = Date.now();
      try {
        const cacheKey = `v2:${videoId}`; // bump when the cached shape changes
        const warm = isCached(cacheKey);
        send({ type: "status", stage: "transcript", message: warm ? "Using cached transcript..." : "Getting transcript..." });

        const prepared = await cached<Prepared>(cacheKey, async () => {
          const transcript = await getTranscript(videoId);
          send({ type: "status", stage: "processing", message: "Processing transcript..." });
          const processed = processTranscript(transcript);
          // Keep only what the response needs; the processed index holds the words.
          const { video, source, language, wordTimings } = transcript;
          return { transcript: { video, source, language, wordTimings }, processed };
        });

        const { video, source, language } = prepared.transcript;
        send({ type: "video", video, source, language });

        // Music-only videos can have an auto-caption track that is nothing but [Music]
        // (plus the odd hallucinated word). Real speech is ~2–3 words per second.
        const wordCount = prepared.processed.tokens.length;
        if (wordCount < 20 && wordCount < video.durationSeconds / 10) {
          send({
            type: "error",
            code: "NO_CAPTIONS",
            message: "This video's captions don't contain any spoken words to search. It may be music-only.",
          });
          return;
        }

        const n = sentences.length;
        send({ type: "status", stage: "searching", message: `Searching for ${n} sentence${n === 1 ? "" : "s"}...` });
        const candidates = findCandidates(sentences, prepared.processed);

        send({ type: "status", stage: "ranking", message: "Ranking matches..." });
        const results = rankCandidates(sentences, candidates);

        send({
          type: "done",
          results,
          summary: { total: n, found: results.filter((r) => r.found).length },
          elapsedMs: Date.now() - started,
        });
      } catch (e) {
        if (e instanceof TranscriptError) {
          console.warn(`[search] ${videoId}: ${e.code} — ${e.detail ?? e.message}`);
          send({ type: "error", code: e.code, message: e.message, detail: e.detail });
        } else {
          console.error(`[search] ${videoId}:`, e);
          send({ type: "error", code: "INTERNAL", message: "Something went wrong while searching. Please try again." });
        }
      } finally {
        controller.close();
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
