"use client";

import { useCallback, useState } from "react";
import { defaultClipName, draftToSpec, ytDlpCommand, type ClipDraft, type ClipSpec } from "@/lib/clip";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl } from "@/lib/youtube";
import {
  MOMENT_COUNTS,
  MOMENT_TYPES,
  type Moment,
  type MomentCount,
  type MomentType,
  type SourcesReport,
  type SourceState,
} from "@/types/moments";
import { Button, CopyButton, DownloadIcon } from "./Button";
import { ErrorPanel } from "./ErrorPanel";
import { formatRange, MomentCard, type Range } from "./MomentCard";
import { ProcessingStatus } from "./ProcessingStatus";
import { Segmented } from "./Segmented";
import { UrlField } from "./UrlField";
import { useClipDownloads, useLocalDownloads } from "./useClipDownloads";
import { useCopy } from "./useCopy";
import { useSharedUrl, useVideoJob } from "./useVideoJob";
import { VideoInfo } from "./VideoInfo";

interface MomentsDone {
  type: "done";
  moments: Moment[];
  requested: number;
  momentType: MomentType;
  notes: string[];
  elapsedMs: number;
}

type SourcesEvent = { type: "sources"; sources: SourcesReport };

const describeDone = (d: MomentsDone) => `Found ${d.moments.length} moment${d.moments.length === 1 ? "" : "s"}`;

export function BestMoments() {
  const [url, setUrl] = useSharedUrl();
  const [type, setType] = useState<MomentType>("all");
  const [count, setCount] = useState<MomentCount>(10);
  const [sources, setSources] = useState<SourcesReport | null>(null);
  const onExtra = useCallback((e: SourcesEvent) => setSources(e.sources), []);
  const job = useVideoJob<MomentsDone, SourcesEvent>("/api/moments", { describeDone, onExtra });
  const { busy, status, video, result, error, urlError, setUrlError, run, resultsRef } = job;

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSources(null);
          run({ url, type, count }, { stage: "validate", message: "Validated YouTube URL" });
        }}
        className="space-y-5 rounded-xl border border-line bg-surface p-4 shadow-sm sm:p-5"
        noValidate
      >
        <UrlField
          value={url}
          onChange={(v) => {
            setUrl(v);
            if (urlError) setUrlError(null);
          }}
          error={urlError}
          disabled={busy}
        />

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
            <Segmented
              label="Number of moments"
              value={count}
              onChange={setCount}
              disabled={busy}
              options={MOMENT_COUNTS.map((n) => ({
                value: n,
                label: (
                  <>
                    {n}
                    <span className="max-sm:hidden"> moments</span>
                  </>
                ),
              }))}
            />
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

        {result && video && (
          <MomentResults
            key={`${video.video.videoId}-${result.momentType}-${result.elapsedMs}`}
            outcome={result}
            videoId={video.video.videoId}
            videoDuration={video.video.durationSeconds}
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
  const keys = Object.keys(SOURCE_LABELS) as (keyof SourcesReport)[];
  return (
    <details className="rounded-lg border border-line bg-surface px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted select-none">
        Sources analyzed:{" "}
        {keys
          .filter((k) => sources[k].state === "used")
          .map((k) => SOURCE_LABELS[k].toLowerCase())
          .join(", ")}
      </summary>
      <dl className="mt-2 space-y-1.5 text-xs">
        {keys.map((k) => (
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

function MomentResults({ outcome, videoId, videoDuration }: { outcome: MomentsDone; videoId: string; videoDuration: number }) {
  const { moments, requested, notes } = outcome;
  const { copied, copy } = useCopy();
  const local = useLocalDownloads();
  const downloads = useClipDownloads();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, ClipDraft>>({});
  const [batchRunning, setBatchRunning] = useState(false);

  const defaultName = (m: Moment) => defaultClipName(m.rank - 1, m.title);
  const draftOf = (m: Moment): ClipDraft =>
    drafts[m.rank] ?? { name: "", start: formatTimestamp(m.start), end: formatTimestamp(m.end) };
  const specOf = (m: Moment): ClipSpec | null => draftToSpec(videoId, draftOf(m), "1080", videoDuration, defaultName(m));
  /** The user's adjusted range when it's valid, else the suggestion. */
  const rangeOf = (m: Moment): Range => {
    const spec = specOf(m);
    return spec ? { start: spec.start, end: spec.end } : m;
  };
  const isAdjusted = (m: Moment) => {
    const d = drafts[m.rank];
    return !!d && (parseTimestamp(d.start) !== m.start || parseTimestamp(d.end) !== m.end) && !!specOf(m);
  };

  const picked = moments.filter((m) => selected.has(m.rank));
  const lines = {
    timestamps: picked.map((m) => `${formatTimestamp(rangeOf(m).start)} | ${m.title}`).join("\n"),
    ranges: picked.map((m) => `${formatRange(rangeOf(m))} | ${m.title}`).join("\n"),
    links: picked.map((m) => buildTimestampUrl(videoId, rangeOf(m).start)).join("\n"),
    commands: picked
      .map(specOf)
      .filter((s): s is ClipSpec => s !== null)
      .map((s) => ytDlpCommand(s))
      .join("\n"),
  };

  async function downloadSelected() {
    const todo = picked.filter((m) => downloads.states[m.rank]?.status !== "done" && specOf(m));
    if (!todo.length) return;
    setBatchRunning(true);
    downloads.queue(todo.map((m) => m.rank));
    // One at a time, like the Timestamp Finder's "Download all clips".
    for (const m of todo) await downloads.download(m.rank, specOf(m)!);
    setBatchRunning(false);
  }

  const toggle = (rank: number, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(rank);
      else next.delete(rank);
      return next;
    });

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
        <div className="z-10 rounded-xl border border-line bg-surface/95 p-3 shadow-sm backdrop-blur sm:sticky sm:top-2 sm:p-4">
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
            <CopyButton label="Copy timestamps" copyKey="sel-ts" text={lines.timestamps} copied={copied} copy={copy} />
            <CopyButton label="Copy clip ranges" copyKey="sel-ranges" text={lines.ranges} copied={copied} copy={copy} />
            <CopyButton label="Copy YouTube links" copyKey="sel-links" text={lines.links} copied={copied} copy={copy} />
            <CopyButton label="Copy download commands" copyKey="sel-cmd" text={lines.commands} copied={copied} copy={copy} />
            {local.status === "ready" && (
              <Button variant="primary" onClick={downloadSelected} disabled={!picked.length || batchRunning}>
                <DownloadIcon />
                {batchRunning ? "Downloading…" : `Download selected${picked.length ? ` (${picked.length})` : ""}`}
              </Button>
            )}
          </div>
          {!selected.size && <p className="mt-2 text-xs text-faint">Tick moments to copy or download them together.</p>}
        </div>
      )}

      <div className="space-y-3">
        {moments.map((m) => (
          <MomentCard
            key={m.rank}
            moment={m}
            videoId={videoId}
            videoDuration={videoDuration}
            range={rangeOf(m)}
            adjusted={isAdjusted(m)}
            selected={selected.has(m.rank)}
            onSelect={(on) => toggle(m.rank, on)}
            draft={draftOf(m)}
            defaultName={defaultName(m)}
            onDraftChange={(d) => setDrafts((all) => ({ ...all, [m.rank]: d }))}
            onReset={() =>
              setDrafts((all) => {
                const next = { ...all };
                delete next[m.rank];
                return next;
              })
            }
            local={local}
            download={downloads.states[m.rank]}
            onDownload={(spec) => downloads.download(m.rank, spec)}
            onCancel={() => downloads.cancel(m.rank)}
            copied={copied}
            copy={copy}
          />
        ))}
      </div>
    </section>
  );
}
