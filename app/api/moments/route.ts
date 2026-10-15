import { findMoments } from "@/lib/moments/analyze";
import { getSignals, type Signal, type Signals } from "@/lib/moments/signals";
import { errorEvent, errorResponse, lacksSpeech, ndjsonResponse } from "@/lib/stream";
import { cached, getTranscript, isCached, isTranscriptCached } from "@/lib/transcript";
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
 * which sources could be used, then the ranked moments. The transcript and
 * the supporting signals are cached for an hour (the transcript is shared with
 * the Timestamp Finder), so trying another moment type is instant.
 */

interface Prepared {
  transcript: Transcript;
  signals: Signals;
}

const signalsKey = (videoId: string) => `signals:v1:${videoId}`;

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
    return errorResponse("INVALID_INPUT", "Invalid request.");
  }

  const videoId = typeof body.url === "string" ? extractVideoId(body.url) : null;
  if (!videoId) return errorResponse("INVALID_URL", "Please enter a valid YouTube URL.");
  const type = (MOMENT_TYPES.find((t) => t.value === body.type)?.value ?? "all") as MomentType;
  const count = MOMENT_COUNTS.find((c) => c === Number(body.count)) ?? 10;
  const label = MOMENT_TYPES.find((t) => t.value === type)!.label;

  return ndjsonResponse<MomentsEvent>(async (send) => {
    const started = Date.now();
    try {
      send({
        type: "status",
        stage: "transcript",
        message: isTranscriptCached(videoId)
          ? "Using cached video information and transcript..."
          : "Retrieving video information and transcript...",
      });
      // Shared with the Timestamp Finder: a video searched there isn't fetched again.
      const transcript = await getTranscript(videoId);
      send({ type: "video", video: transcript.video, source: transcript.source, language: transcript.language });

      if (!isCached(signalsKey(videoId))) {
        send({ type: "status", stage: "supporting", message: "Checking chapters, top comments and replay data..." });
      }
      const signals = await cached(signalsKey(videoId), () =>
        getSignals(videoId, transcript.description ?? "", transcript.video.durationSeconds),
      );
      send({ type: "sources", sources: report({ transcript, signals }) });

      if (lacksSpeech(transcript)) {
        send({
          type: "error",
          code: "NO_CAPTIONS",
          message: "This video's captions don't contain enough spoken words to analyze. It may be music-only.",
        });
        return;
      }

      const { moments, candidateCount } = findMoments({ transcript, signals, type, count }, (stage, n) =>
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
      const ev = errorEvent(e, "moments", videoId, "Something went wrong while analyzing. Please try again.");
      if (ev.code === "NO_CAPTIONS" || ev.code === "TRANSCRIPT_UNAVAILABLE") {
        ev.message += " Best Moments needs a transcript, so automatic analysis isn't possible for this video.";
      }
      send(ev);
    }
  });
}
