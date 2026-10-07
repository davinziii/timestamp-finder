"use client";

import { useRef, useState } from "react";
import { validateSentences } from "@/lib/sentences";
import { extractVideoId } from "@/lib/youtube";
import type { ErrorCode, SearchEvent, SearchSummary, SentenceResult } from "@/types/search";
import type { TranscriptSource, VideoInfo as Video } from "@/types/transcript";
import { ProcessingStatus, type StatusLine } from "./ProcessingStatus";
import { SearchForm } from "./SearchForm";
import { SearchResults } from "./SearchResults";
import { VideoInfo } from "./VideoInfo";

interface SearchError {
  code: ErrorCode;
  message: string;
  detail?: string;
}

interface Outcome {
  results: SentenceResult[];
  summary: SearchSummary;
  elapsedMs: number;
}

const ERROR_TITLES: Partial<Record<ErrorCode, string>> = {
  TRANSCRIPT_UNAVAILABLE: "Transcript unavailable",
  NO_CAPTIONS: "Transcript unavailable",
  VIDEO_UNAVAILABLE: "Video unavailable",
  INVALID_INPUT: "Check your input",
  INTERNAL: "Something went wrong",
};

export function TimestampFinder() {
  const [url, setUrl] = useState("");
  const [sentences, setSentences] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusLine[]>([]);
  const [video, setVideo] = useState<{ video: Video; source: TranscriptSource } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<SearchError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function run() {
    if (busy) return;
    const videoId = extractVideoId(url);
    if (!videoId) {
      setUrlError(url.trim() ? "Please enter a valid YouTube URL." : "Paste a YouTube video URL.");
      return;
    }
    setUrlError(null);
    const check = validateSentences(sentences);
    if (!check.ok) {
      setError({ code: "INVALID_INPUT", message: check.message });
      setOutcome(null);
      setStatus([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setStatus([]);
    if (video?.video.videoId !== videoId) setVideo(null);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, sentences }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const ev = (await res.json().catch(() => null)) as SearchEvent | null;
        if (ev?.type === "error") {
          if (ev.code === "INVALID_URL") setUrlError(ev.message);
          else setError(ev);
        } else {
          setError({ code: "INTERNAL", message: `The server responded with an error (${res.status}).` });
        }
        return;
      }

      // Read the NDJSON stream event by event.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as SearchEvent;
          if (ev.type === "status") setStatus((s) => [...s, { stage: ev.stage, message: ev.message }]);
          else if (ev.type === "video") setVideo({ video: ev.video, source: ev.source });
          else if (ev.type === "done") {
            finished = true;
            setOutcome({ results: ev.results, summary: ev.summary, elapsedMs: ev.elapsedMs });
            setStatus((s) => [
              ...s,
              { stage: "done", message: `Found ${ev.summary.found}/${ev.summary.total} sentences` },
            ]);
          } else if (ev.type === "error") {
            finished = true;
            setError(ev);
          }
        }
      }
      if (!finished) setError({ code: "INTERNAL", message: "The connection closed before the search finished." });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError({ code: "INTERNAL", message: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <SearchForm
        url={url}
        sentences={sentences}
        onUrlChange={(v) => {
          setUrl(v);
          if (urlError) setUrlError(null);
        }}
        onSentencesChange={setSentences}
        onSubmit={run}
        busy={busy}
        urlError={urlError}
      />

      <div ref={resultsRef} className="scroll-mt-6 space-y-6">
        {(status.length > 0 || video) && (
          <div className="space-y-4 border-t border-line pt-6">
            {video && <VideoInfo video={video.video} source={video.source} />}
            <ProcessingStatus lines={status} active={busy} />
          </div>
        )}

        {error && <ErrorPanel error={error} />}

        {outcome && video && (
          <SearchResults
            key={`${video.video.videoId}-${outcome.elapsedMs}`}
            results={outcome.results}
            summary={outcome.summary}
            videoId={video.video.videoId}
            videoDuration={video.video.durationSeconds}
            maxHeight={video.video.maxHeight ?? 0}
          />
        )}
      </div>
    </div>
  );
}

function ErrorPanel({ error }: { error: SearchError }) {
  const title = ERROR_TITLES[error.code] ?? "Something went wrong";
  return (
    <div role="alert" className="animate-rise rounded-xl border border-bad/30 bg-bad-soft p-4 sm:p-5">
      <p className="font-medium text-bad">{title}.</p>
      <p className="mt-1 text-sm leading-relaxed text-fg/80">{error.message}</p>
      {error.detail && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <p className="mt-1.5 font-mono break-words">{error.detail}</p>
        </details>
      )}
    </div>
  );
}
