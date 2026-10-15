"use client";

import { useRef, useState } from "react";
import { defaultClipName, ytDlpCommand, type ClipSpec } from "@/lib/clip";
import { formatTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl, extractVideoId } from "@/lib/youtube";
import {
  MOMENT_COUNTS,
  MOMENT_TYPES,
  type Moment,
  type MomentCount,
  type MomentsEvent,
  type MomentType,
  type SourcesReport,
  type SourceState,
} from "@/types/moments";
import type { TranscriptSource, VideoInfo as Video } from "@/types/transcript";
import { Button, CheckIcon, CopyIcon, DownloadIcon } from "./Button";
import { clipRange, MomentCard } from "./MomentCard";
import { ProcessingStatus, type StatusLine } from "./ProcessingStatus";
import { ErrorPanel, type SearchError } from "./TimestampFinder";
import { useClipDownloads, useLocalDownloads } from "./useClipDownloads";
import { useCopy } from "./useCopy";
import { VideoInfo } from "./VideoInfo";

interface Outcome {
  moments: Moment[];
  requested: number;
  momentType: MomentType;
  notes: string[];
}

export function BestMoments() {
  const [url, setUrl] = useState("");
  const [type, setType] = useState<MomentType>("all");
  const [count, setCount] = useState<MomentCount>(10);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusLine[]>([]);
  const [video, setVideo] = useState<{ video: Video; source: TranscriptSource } | null>(null);
  const [sources, setSources] = useState<SourcesReport | null>(null);
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

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setSources(null);
    setStatus([{ stage: "validate", message: "Validated YouTube URL" }]);
    if (video?.video.videoId !== videoId) setVideo(null);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    try {
      const res = await fetch("/api/moments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, type, count }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const ev = (await res.json().catch(() => null)) as MomentsEvent | null;
        if (ev?.type === "error") {
          if (ev.code === "INVALID_URL") setUrlError(ev.message);
          else setError(ev);
        } else {
          setError({ code: "INTERNAL", message: `The server responded with an error (${res.status}).` });
        }
        setStatus([]);
        return;
      }

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
          const ev = JSON.parse(line) as MomentsEvent;
          if (ev.type === "status") setStatus((s) => [...s, { stage: ev.stage, message: ev.message }]);
          else if (ev.type === "video") setVideo({ video: ev.video, source: ev.source });
          else if (ev.type === "sources") setSources(ev.sources);
          else if (ev.type === "done") {
            finished = true;
            setOutcome({ moments: ev.moments, requested: ev.requested, momentType: ev.momentType, notes: ev.notes });
            setStatus((s) => [
              ...s,
              { stage: "done", message: `Found ${ev.moments.length} moment${ev.moments.length === 1 ? "" : "s"}` },
            ]);
          } else if (ev.type === "error") {
            finished = true;
            setError(ev);
          }
        }
      }
      if (!finished) setError({ code: "INTERNAL", message: "The connection closed before the analysis finished." });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError({ code: "INTERNAL", message: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="space-y-5 rounded-xl border border-line bg-surface p-4 shadow-sm sm:p-5"
        noValidate
      >
        <div>
          <label htmlFor="url" className="mb-1.5 block text-[13px] font-medium">
            YouTube URL
          </label>
          <input
            id="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              if (urlError) setUrlError(null);
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-invalid={!!urlError}
            aria-describedby={urlError ? "url-error" : undefined}
            className={`block h-11 w-full rounded-lg border bg-surface px-3.5 font-mono text-[13px] shadow-xs outline-none placeholder:font-sans placeholder:text-faint focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60 ${
              urlError ? "border-bad" : "border-line focus:border-line-strong"
            }`}
          />
          {urlError && (
            <p id="url-error" className="mt-1.5 text-xs text-bad">
              {urlError}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-[13px] font-medium">Moment type</legend>
          <div role="radiogroup" aria-label="Moment type" className="flex flex-wrap gap-1.5">
            {MOMENT_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                disabled={busy}
                onClick={() => setType(t.value)}
                className={`rounded-md border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-60 ${
                  type === t.value
                    ? "border-accent bg-accent-soft font-medium text-fg"
                    : "border-line text-muted hover:border-line-strong hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <fieldset>
            <legend className="mb-1.5 block text-[13px] font-medium">Number of moments</legend>
            <div role="radiogroup" aria-label="Number of results" className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
              {MOMENT_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={count === n}
                  disabled={busy}
                  onClick={() => setCount(n)}
                  className={`rounded px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                    count === n ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
                  }`}
                >
                  {n}
                  <span className="max-sm:hidden"> moments</span>
                </button>
              ))}
            </div>
          </fieldset>
          <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full sm:w-auto">
            {busy ? (
              <>
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
                Analyzing…
              </>
            ) : (
              "Find Best Moments"
            )}
          </Button>
        </div>
      </form>

      <div ref={resultsRef} className="scroll-mt-6 space-y-6">
        {(status.length > 0 || video) && (
          <div className="space-y-4 border-t border-line pt-6">
            {video && <VideoInfo video={video.video} source={video.source} />}
            <ProcessingStatus lines={status} active={busy} />
            {sources && <SourcesPanel sources={sources} />}
          </div>
        )}

        {error && <ErrorPanel error={error} />}

        {outcome && video && (
          <MomentResults
            key={`${video.video.videoId}-${outcome.momentType}-${outcome.moments.map((m) => m.start).join()}`}
            outcome={outcome}
            videoId={video.video.videoId}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<keyof SourcesReport, string> = {
  transcript: "Transcript",
  metadata: "Title & description",
  chapters: "Chapters",
  comments: "Top comments",
  replay: "Most replayed",
  visual: "Video & audio",
};

const STATE_STYLE: Record<SourceState, { text: string; label: string }> = {
  used: { text: "text-ok", label: "Used" },
  empty: { text: "text-faint", label: "None" },
  unavailable: { text: "text-warn", label: "Unavailable" },
  "not-analyzed": { text: "text-faint", label: "Not analyzed" },
};

function SourcesPanel({ sources }: { sources: SourcesReport }) {
  return (
    <details className="rounded-lg border border-line bg-surface px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted select-none">
        Sources analyzed:{" "}
        {(Object.keys(SOURCE_LABELS) as (keyof SourcesReport)[])
          .filter((k) => sources[k].state === "used")
          .map((k) => SOURCE_LABELS[k].toLowerCase())
          .join(", ")}
      </summary>
      <dl className="mt-2 space-y-1.5 text-xs">
        {(Object.keys(SOURCE_LABELS) as (keyof SourcesReport)[]).map((k) => (
          <div key={k} className="grid grid-cols-[8.5rem_5.5rem_1fr] gap-2 max-sm:grid-cols-[7rem_1fr]">
            <dt className="font-medium">{SOURCE_LABELS[k]}</dt>
            <dd className={STATE_STYLE[sources[k].state].text}>{STATE_STYLE[sources[k].state].label}</dd>
            <dd className="text-muted max-sm:col-span-2">{sources[k].detail}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function MomentResults({ outcome, videoId }: { outcome: Outcome; videoId: string }) {
  const { moments, requested, notes } = outcome;
  const { copied, copy } = useCopy();
  const local = useLocalDownloads();
  const downloads = useClipDownloads();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);

  const specOf = (m: Moment): ClipSpec => ({
    videoId,
    start: m.start,
    end: m.end,
    name: defaultClipName(m.rank - 1, m.title),
    quality: "1080",
  });
  const picked = moments.filter((m) => selected.has(m.rank));
  const lines = {
    timestamps: picked.map((m) => `${formatTimestamp(m.start)} | ${m.title}`).join("\n"),
    ranges: picked.map((m) => `${clipRange(m)} | ${m.title}`).join("\n"),
    links: picked.map((m) => buildTimestampUrl(videoId, m.start)).join("\n"),
    commands: picked.map((m) => ytDlpCommand(specOf(m))).join("\n"),
  };

  async function downloadSelected() {
    const todo = picked.filter((m) => downloads.states[m.rank]?.status !== "done");
    if (!todo.length) return;
    setBatchRunning(true);
    downloads.queue(todo.map((m) => m.rank));
    // One at a time, like the Timestamp Finder's "Download all clips".
    for (const m of todo) await downloads.download(m.rank, specOf(m));
    setBatchRunning(false);
  }

  return (
    <section aria-label="Best moments" className="space-y-4">
      <div>
        <p className="font-mono text-xs tracking-wider text-faint uppercase">Results</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {moments.length === 0 ? (
            <span className="text-bad">No strong moments found</span>
          ) : (
            <>
              {moments.length} {moments.length === 1 ? "moment" : "moments"}
              {moments.length < requested && <span className="text-muted"> of {requested} requested</span>}
            </>
          )}
        </p>
        {notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-muted">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      {moments.length > 0 && (
        <div className="z-10 rounded-xl sm:sticky sm:top-2 border border-line bg-surface/95 p-3 shadow-sm backdrop-blur sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[13px] font-medium">
              {selected.size} of {moments.length} selected
            </span>
            <Button onClick={() => setSelected(new Set(moments.map((m) => m.rank)))} disabled={selected.size === moments.length}>
              Select all
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>
              Clear selection
            </Button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <CopyAll label="Copy timestamps" k="sel-ts" text={lines.timestamps} copied={copied} copy={copy} />
            <CopyAll label="Copy clip ranges" k="sel-ranges" text={lines.ranges} copied={copied} copy={copy} />
            <CopyAll label="Copy YouTube links" k="sel-links" text={lines.links} copied={copied} copy={copy} />
            <CopyAll label="Copy download commands" k="sel-cmd" text={lines.commands} copied={copied} copy={copy} />
            {local.status === "ready" && (
              <Button variant="primary" onClick={downloadSelected} disabled={!picked.length || batchRunning}>
                <DownloadIcon />
                {batchRunning ? "Downloading…" : `Download selected${picked.length ? ` (${picked.length})` : ""}`}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {moments.map((m) => (
          <MomentCard
            key={m.rank}
            moment={m}
            videoId={videoId}
            selected={selected.has(m.rank)}
            onSelect={(on) =>
              setSelected((s) => {
                const next = new Set(s);
                if (on) next.add(m.rank);
                else next.delete(m.rank);
                return next;
              })
            }
            spec={specOf(m)}
            canDownload={local.status === "ready"}
            download={downloads.states[m.rank]}
            onDownload={() => downloads.download(m.rank, specOf(m))}
            onCancel={() => downloads.cancel(m.rank)}
            copied={copied}
            copy={copy}
          />
        ))}
      </div>
    </section>
  );
}

function CopyAll({
  label,
  k,
  text,
  copied,
  copy,
}: {
  label: string;
  k: string;
  text: string;
  copied: string | null;
  copy: (key: string, text: string) => void;
}) {
  return (
    <Button onClick={() => copy(k, text)} disabled={!text}>
      {copied === k ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon />}
      {copied === k ? "Copied" : label}
    </Button>
  );
}
