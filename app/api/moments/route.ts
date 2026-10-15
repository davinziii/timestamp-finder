import { findMoments } from "@/lib/moments/analyze";
import { getSignals, type Signal, type Signals } from "@/lib/moments/signals";
import { cached, getTranscript, isCached, TranscriptError } from "@/lib/transcript";
import { extractVideoId } from "@/lib/youtube";
import {
  MOMENT_COUNTS,
  MOMENT_TYPES,
  type MomentsEvent,
  type MomentType,
  type SourcesReport,
  type SourceStatus,
} from "@/types/moments";
import type { Transcript } from "@/types/transcript";

/*
 * POST /api/moments  { url: string, type: MomentType, count: 5 | 10 | 15 | 20 }
 *
 * Streams newline-delimited JSON (MomentsEvent): the real processing stages,
 * which sources could be used, then the ranked moments. The transcript is
 * fetched once per video (cached 1h with the supporting signals), so trying
 * another moment type is instant.
 */

interface Prepared {
  transcript: Transcript;
  signals: Signals;
}

function sourceStatus<T extends unknown[]>(s: Signal<T>, used: (v: T) => string): SourceStatus {
  if (s.state === "ok") return { state: "used", detail: used(s.value) };
  return { state: s.state, detail: s.reason };
}

function report(p: Prepared): SourcesReport {
  const t = p.transcript;
  return {
    transcript: {
      state: "used",
      detail: `${t.source === "youtube-asr" ? "Auto-generated" : "Uploaded"} captions (${t.language}), ${t.segments.length} caption lines.`,
    },
    metadata: {
      state: "used",
      detail: t.description?.trim() ? "Title and description." : "Title (the description is empty).",
    },
    chapters: sourceStatus(p.signals.chapters, (v) => `${v.length} chapters.`),
    comments: sourceStatus(p.signals.comments, (v) => `${v.length} top comments.`),
    replay: sourceStatus(p.signals.heatmap, () => "YouTube's most-replayed graph."),
    visual: {
      state: "not-analyzed",
      detail: "ClipFinder doesn't watch or listen to the video. Moments that are only visual can be missed.",
    },
  };
}

export async function POST(request: Request) {
  let body: { url?: unknown; type?: unknown; count?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ type: "error", code: "INVALID_INPUT", message: "Invalid request." }, { status: 400 });
  }

  const videoId = typeof body.url === "string" ? extractVideoId(body.url) : null;
  if (!videoId) {
    return Response.json(
      { type: "error", code: "INVALID_URL", message: "Please enter a valid YouTube URL." } satisfies MomentsEvent,
      { status: 400 },
    );
  }
  const type = (MOMENT_TYPES.find((t) => t.value === body.type)?.value ?? "all") as MomentType;
  const count = MOMENT_COUNTS.find((c) => c === Number(body.count)) ?? 10;
  const label = MOMENT_TYPES.find((t) => t.value === type)!.label;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: MomentsEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const started = Date.now();
      try {
        const cacheKey = `moments:v1:${videoId}`;
        const warm = isCached(cacheKey);
        send({
          type: "status",
          stage: "transcript",
          message: warm ? "Using cached video information and transcript..." : "Retrieving video information and transcript...",
        });

        const prepared = await cached<Prepared>(cacheKey, async () => {
          const transcript = await getTranscript(videoId);
          send({ type: "video", video: transcript.video, source: transcript.source, language: transcript.language });
          send({ type: "status", stage: "supporting", message: "Checking chapters, top comments and replay data..." });
          const signals = await getSignals(videoId, transcript.description ?? "", transcript.video.durationSeconds);
          return { transcript, signals };
        });
        const { transcript } = prepared;
        if (warm) send({ type: "video", video: transcript.video, source: transcript.source, language: transcript.language });
        send({ type: "sources", sources: report(prepared) });

        // Music-only videos can have a caption track that is nothing but [Music].
        if (transcript.words.length < 20 && transcript.words.length < transcript.video.durationSeconds / 10) {
          send({
            type: "error",
            code: "NO_CAPTIONS",
            message: "This video's captions don't contain enough spoken words to analyze. It may be music-only.",
          });
          return;
        }

        const { moments, candidateCount } = findMoments({ transcript, signals: prepared.signals, type, count }, (stage, n) =>
          send(
            stage === "candidates"
              ? { type: "status", stage, message: "Identifying candidate moments..." }
              : { type: "status", stage, message: `Ranking ${n} candidate${n === 1 ? "" : "s"} for ${label}...` },
          ),
        );

        send({ type: "status", stage: "preparing", message: "Preparing results..." });
        const notes: string[] = [];
        if (moments.length < count) {
          notes.push(
            moments.length === 0
              ? type === "all"
                ? "This video didn't yield enough strong candidates from its transcript and viewer signals."
                : `The video didn't yield enough strong candidates for ${label}. Try another moment type.`
              : `Only ${moments.length} strong ${moments.length === 1 ? "match was" : "matches were"} found for ${label}. ClipFinder doesn't pad the list with weak ones.`,
          );
        }
        if (transcript.source === "youtube-asr") {
          notes.push("The transcript is auto-generated, so excerpts can contain recognition errors.");
        }
        notes.push(
          "Moments are found from the transcript's wording and timing plus viewer signals. Titles are keyword summaries, not quotes.",
        );
        console.info(`[moments] ${videoId} ${type}: ${moments.length}/${count} from ${candidateCount} candidates`);

        send({ type: "done", moments, requested: count, momentType: type, notes, elapsedMs: Date.now() - started });
      } catch (e) {
        if (e instanceof TranscriptError) {
          console.warn(`[moments] ${videoId}: ${e.code} — ${e.detail ?? e.message}`);
          const message =
            e.code === "VIDEO_UNAVAILABLE"
              ? e.message
              : `${e.message} Best Moments needs a transcript, so automatic analysis isn't possible for this video.`;
          send({ type: "error", code: e.code, message, detail: e.detail });
        } else {
          console.error(`[moments] ${videoId}:`, e);
          send({ type: "error", code: "INTERNAL", message: "Something went wrong while analyzing. Please try again." });
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
