import { processTranscript, findCandidates, rankCandidates, type ProcessedTranscript } from "@/lib/search";
import { validateSentences } from "@/lib/sentences";
import { errorEvent, errorResponse, lacksSpeech, ndjsonResponse } from "@/lib/stream";
import { cached, getTranscript, isCached, isTranscriptCached } from "@/lib/transcript";
import { extractVideoId } from "@/lib/youtube";
import type { SearchEvent } from "@/types/search";

/*
 * POST /api/search  { url: string, sentences: string }
 *
 * Streams newline-delimited JSON (SearchEvent) so the UI can show each real
 * processing stage as it happens. The transcript never leaves the server;
 * only matches are returned. The transcript itself is cached by
 * getTranscript() (shared with Best Moments); the search index built from it
 * is cached here.
 */

export async function POST(request: Request) {
  let body: { url?: unknown; sentences?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_INPUT", "Invalid request.");
  }

  const videoId = typeof body.url === "string" ? extractVideoId(body.url) : null;
  if (!videoId) return errorResponse("INVALID_URL", "Please enter a valid YouTube URL.");
  const validation = validateSentences(typeof body.sentences === "string" ? body.sentences : "");
  if (!validation.ok) return errorResponse("INVALID_INPUT", validation.message);
  const sentences = validation.sentences;

  return ndjsonResponse<SearchEvent>(async (send) => {
    const started = Date.now();
    try {
      send({
        type: "status",
        stage: "transcript",
        message: isTranscriptCached(videoId) ? "Using cached transcript..." : "Getting transcript...",
      });
      const transcript = await getTranscript(videoId);
      const { video, source, language } = transcript;

      const indexKey = `search:v3:${videoId}`; // bump when the index shape changes
      if (!isCached(indexKey)) send({ type: "status", stage: "processing", message: "Processing transcript..." });
      const processed = await cached<ProcessedTranscript>(indexKey, async () => processTranscript(transcript));
      send({ type: "video", video, source, language });

      if (lacksSpeech(transcript)) {
        send({
          type: "error",
          code: "NO_CAPTIONS",
          message: "This video's captions don't contain any spoken words to search. It may be music-only.",
        });
        return;
      }

      const n = sentences.length;
      send({ type: "status", stage: "searching", message: `Searching for ${n} sentence${n === 1 ? "" : "s"}...` });
      const candidates = findCandidates(sentences, processed);

      send({ type: "status", stage: "ranking", message: "Ranking matches..." });
      const results = rankCandidates(sentences, candidates);

      send({
        type: "done",
        results,
        summary: { total: n, found: results.filter((r) => r.found).length },
        elapsedMs: Date.now() - started,
      });
    } catch (e) {
      send(errorEvent(e, "search", videoId, "Something went wrong while searching. Please try again."));
    }
  });
}
