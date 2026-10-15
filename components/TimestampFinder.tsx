"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ClipDraft } from "@/lib/clip";
import { validateSentences } from "@/lib/sentences";
import { extractVideoId } from "@/lib/youtube";
import type { SearchSummary, SentenceResult } from "@/types/search";
import { ErrorPanel } from "./ErrorPanel";
import { ProcessingStatus } from "./ProcessingStatus";
import { SearchForm } from "./SearchForm";
import { SearchResults } from "./SearchResults";
import { TrimPanel } from "./TrimPanel";
import { useSharedUrl, useVideoJob } from "./useVideoJob";
import { VideoInfo } from "./VideoInfo";

interface SearchDone {
  type: "done";
  results: SentenceResult[];
  summary: SearchSummary;
  elapsedMs: number;
}

const describeDone = (d: SearchDone) => `Found ${d.summary.found}/${d.summary.total} sentences`;

export function TimestampFinder() {
  const [url, setUrl] = useSharedUrl();
  const [sentences, setSentences] = useState("");
  const [trim, setTrim] = useState<ClipDraft>({ name: "", start: "", end: "" });
  const [trimOpen, setTrimOpen] = useState(false);
  const job = useVideoJob<SearchDone>("/api/search", { describeDone });
  const { busy, status, video, result, error, urlError, setUrlError, run, fail, resultsRef } = job;

  const search = useCallback(
    (input: { url: string; sentences: string }) => {
      // URL problems come first (run() reports them); then the sentences.
      if (extractVideoId(input.url)) {
        const check = validateSentences(input.sentences);
        if (!check.ok) {
          setUrlError(null);
          fail({ code: "INVALID_INPUT", message: check.message });
          return;
        }
      }
      run(input);
    },
    [run, fail, setUrlError],
  );

  /** Arriving from Best Moments: fill in the video, phrase and clip range, then search. */
  const prefill = useCallback(
    (p: Prefill) => {
      setUrl(p.url);
      if (p.start || p.end) {
        setTrim((t) => ({ ...t, start: p.start, end: p.end }));
        setTrimOpen(true);
      }
      if (p.q) {
        setSentences(p.q);
        search({ url: p.url, sentences: p.q });
      }
    },
    [setUrl, search],
  );

  return (
    <div className="space-y-6">
      <SearchForm
        url={url}
        sentences={sentences}
        onUrlChange={(v) => {
          setUrl(v);
          if (urlError) setUrlError(null);
        }}
        onSentencesChange={setSentences}
        onSubmit={() => search({ url, sentences })}
        busy={busy}
        urlError={urlError}
      />

      <TrimPanel url={url} video={video?.video ?? null} draft={trim} onDraftChange={setTrim} open={trimOpen} onOpenChange={setTrimOpen} />

      <Suspense fallback={null}>
        <QueryPrefill onPrefill={prefill} />
      </Suspense>

      <div ref={resultsRef} className="scroll-mt-6 space-y-6">
        {(status.length > 0 || video) && (
          <div className="space-y-4 border-t border-line pt-6">
            {video && <VideoInfo video={video.video} source={video.source} />}
            <ProcessingStatus lines={status} active={busy} />
          </div>
        )}

        {error && <ErrorPanel error={error} />}

        {result && video && (
          <SearchResults
            key={`${video.video.videoId}-${result.elapsedMs}`}
            results={result.results}
            summary={result.summary}
            videoId={video.video.videoId}
            videoDuration={video.video.durationSeconds}
            maxHeight={video.video.maxHeight ?? 0}
          />
        )}
      </div>
    </div>
  );
}

interface Prefill {
  url: string;
  q: string;
  start: string;
  end: string;
}

/**
 * Reads ?url=&q=&start=&end= (links from Best Moments), then clears them from
 * the address bar. Runs for every new hand-off: Next keeps this page mounted
 * between visits, so it isn't a one-time mount.
 */
function QueryPrefill({ onPrefill }: { onPrefill: (p: Prefill) => void }) {
  const params = useSearchParams();
  const handled = useRef("");
  const latest = useRef(onPrefill);
  useEffect(() => {
    latest.current = onPrefill;
  });
  useEffect(() => {
    const url = params.get("url");
    const key = params.toString();
    if (!url || key === handled.current) return;
    handled.current = key;
    window.history.replaceState(null, "", window.location.pathname);
    latest.current({ url, q: params.get("q") ?? "", start: params.get("start") ?? "", end: params.get("end") ?? "" });
  }, [params]);
  return null;
}
