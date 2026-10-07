"use client";

import { useState } from "react";
import {
  CLIP_QUALITY_LABELS,
  DEFAULT_CLIP_SECONDS,
  defaultClipName,
  offersAbove1080,
  resolutionLabel,
  validateClip,
  ytDlpCommand,
  type ClipQuality,
  type ClipSpec,
} from "@/lib/clip";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl } from "@/lib/youtube";
import type { Match, SearchSummary, SentenceResult } from "@/types/search";
import { Button, CheckIcon, CopyIcon, DownloadIcon } from "./Button";
import { QualityToggle } from "./QualityToggle";
import { TimestampResult, type ClipDraft } from "./TimestampResult";
import { useCopy } from "./useCopy";
import { useClipDownloads, useLocalDownloads } from "./useClipDownloads";

/** A clip starting at the match and running DEFAULT_CLIP_SECONDS (capped at the video's end). */
function draftFor(r: SentenceResult, m: Match, videoDuration: number, keep?: ClipDraft): ClipDraft {
  const start = Math.floor(m.start);
  const end = videoDuration > 0 ? Math.min(start + DEFAULT_CLIP_SECONDS, videoDuration) : start + DEFAULT_CLIP_SECONDS;
  return {
    name: keep?.name ?? defaultClipName(r.index, r.query),
    start: formatTimestamp(start),
    end: formatTimestamp(end),
    quality: keep?.quality,
  };
}

export function toClipSpec(videoId: string, d: ClipDraft, quality: ClipQuality): ClipSpec | null {
  const start = parseTimestamp(d.start);
  const end = parseTimestamp(d.end);
  if (start === null || end === null) return null;
  const spec = { videoId, start, end, name: d.name, quality };
  return validateClip(spec) ? null : spec;
}

export function SearchResults({
  results,
  summary,
  videoId,
  videoDuration,
  maxHeight,
}: {
  results: SentenceResult[];
  summary: SearchSummary;
  videoId: string;
  videoDuration: number;
  /** Highest resolution the video has (0 = unknown). */
  maxHeight: number;
}) {
  const { copied, copy } = useCopy();
  const local = useLocalDownloads();
  const downloads = useClipDownloads();
  const [quality, setQuality] = useState<ClipQuality>("1080");
  const [batchRunning, setBatchRunning] = useState(false);
  // Which match (best or an alternative) the user picked for each sentence.
  const [selected, setSelected] = useState<Record<number, number>>({});
  // Clip name, range and resolution override per sentence; created lazily from the chosen match.
  const [drafts, setDrafts] = useState<Record<number, ClipDraft>>({});

  const canGoHigher = offersAbove1080(maxHeight);
  const qualityLabels: Record<ClipQuality, string> = {
    "1080": "1080p",
    best: maxHeight ? resolutionLabel(maxHeight) : "Best (up to 4K)",
  };
  const qualityHints = {
    "1080": CLIP_QUALITY_LABELS["1080"].hint,
    best: CLIP_QUALITY_LABELS.best.hint,
  };

  const chosen = (r: SentenceResult): Match | null =>
    r.found && r.best ? ([r.best, ...r.alternatives][selected[r.index] ?? 0] ?? r.best) : null;
  const draftOf = (r: SentenceResult): ClipDraft | null => {
    const m = chosen(r);
    return m ? (drafts[r.index] ?? draftFor(r, m, videoDuration)) : null;
  };
  /** A clip's own choice wins; otherwise the global default. 1080p if the video has nothing higher. */
  const qualityOf = (d: ClipDraft | null): ClipQuality => (canGoHigher ? (d?.quality ?? quality) : "1080");
  const specOf = (r: SentenceResult): ClipSpec | null => {
    const d = draftOf(r);
    return d ? toClipSpec(videoId, d, qualityOf(d)) : null;
  };
  const found = results.filter((r) => chosen(r));

  const allTimestamps = results
    .map((r) => {
      const m = chosen(r);
      return `Sentence ${r.index + 1} — ${m ? formatTimestamp(m.start) : "not found"}`;
    })
    .join("\n");
  const allLinks = results
    .map((r) => {
      const m = chosen(r);
      return m ? buildTimestampUrl(videoId, m.start) : `Sentence ${r.index + 1} — not found`;
    })
    .join("\n");
  const allCommands = found
    .map(specOf)
    .filter((s): s is ClipSpec => s !== null)
    .map((s) => ytDlpCommand(s))
    .join("\n");

  async function downloadAll() {
    const keys = found
      .filter((r) => downloads.states[r.index]?.status !== "done" && specOf(r))
      .map((r) => r.index);
    if (!keys.length) return;
    setBatchRunning(true);
    downloads.queue(keys);
    // One at a time: kinder to YouTube and keeps progress readable.
    for (const r of found) {
      if (!keys.includes(r.index)) continue;
      const spec = specOf(r);
      if (spec) await downloads.download(r.index, spec);
    }
    setBatchRunning(false);
  }

  const missing = summary.total - summary.found;
  const allFound = missing === 0;
  const doneCount = found.filter((r) => downloads.states[r.index]?.status === "done").length;

  return (
    <section aria-label="Results" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-wider text-faint uppercase">Results</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            Found{" "}
            <span className={allFound ? "text-ok" : summary.found === 0 ? "text-bad" : ""}>
              {summary.found}/{summary.total}
            </span>{" "}
            {summary.total === 1 ? "sentence" : "sentences"}
          </p>
          {!allFound && summary.found > 0 && (
            <p className="mt-1 text-[13px] text-muted">
              <span className="text-ok">✓ {summary.found} found</span>
              <span className="mx-2 text-faint">·</span>
              <span className="text-bad">✕ {missing} not found</span>
            </p>
          )}
        </div>
        {summary.found > 0 && (
          <div className="flex flex-wrap gap-2">
            <CopyAll label="Copy all timestamps" k="all-ts" text={allTimestamps} copied={copied} copy={copy} />
            <CopyAll label="Copy all links" k="all-links" text={allLinks} copied={copied} copy={copy} />
          </div>
        )}
      </div>

      {summary.found > 0 && (
        <div className="rounded-xl border border-line bg-surface p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">Clip downloads</p>
              <p className="mt-0.5 truncate text-xs text-faint">
                {local.status === "ready" ? (
                  <>
                    Saves to <span className="font-mono">{local.folder}</span> · H.264, exact cut ·{" "}
                    {local.encoder === "h264_nvenc" ? "GPU encoding" : "CPU encoding"}
                  </>
                ) : local.status === "checking" ? (
                  "Checking for yt-dlp…"
                ) : (
                  <>Copy the commands and run them with yt-dlp. {local.reason}</>
                )}
              </p>
            </div>
            {canGoHigher ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-faint">Default</span>
                <QualityToggle value={quality} onChange={setQuality} labels={qualityLabels} hints={qualityHints} />
              </div>
            ) : (
              <span className="text-xs text-faint">
                This video is available up to {maxHeight ? resolutionLabel(maxHeight) : "1080p"}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {local.status === "ready" && (
              <Button variant="primary" onClick={downloadAll} disabled={batchRunning}>
                <DownloadIcon />
                {batchRunning
                  ? `Downloading ${doneCount}/${found.length}…`
                  : doneCount === found.length
                    ? "All clips downloaded"
                    : `Download all clips (${found.length - doneCount})`}
              </Button>
            )}
            <CopyAll label="Copy all download commands" k="all-cmd" text={allCommands} copied={copied} copy={copy} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {results.map((r) => {
          const draft = draftOf(r);
          return (
            <TimestampResult
              key={r.index}
              result={r}
              videoId={videoId}
              selected={selected[r.index] ?? 0}
              onSelect={(i) => {
                setSelected((s) => ({ ...s, [r.index]: i }));
                // New moment: move the clip range there but keep the user's name and resolution.
                const m = [r.best!, ...r.alternatives][i];
                setDrafts((d) => ({ ...d, [r.index]: draftFor(r, m, videoDuration, d[r.index]) }));
              }}
              draft={draft}
              onDraftChange={(d) => setDrafts((all) => ({ ...all, [r.index]: d }))}
              quality={qualityOf(draft)}
              onQualityChange={
                canGoHigher && draft
                  ? (q) =>
                      setDrafts((all) => ({
                        ...all,
                        // Picking the same as the default means "follow the default" again.
                        [r.index]: { ...draft, quality: q === quality ? undefined : q },
                      }))
                  : null
              }
              qualityLabels={qualityLabels}
              qualityHints={qualityHints}
              cpuEncoding={local.status === "ready" && local.encoder !== "h264_nvenc"}
              canDownload={local.status === "ready"}
              download={downloads.states[r.index]}
              onDownload={(spec) => downloads.download(r.index, spec)}
              onCancel={() => downloads.cancel(r.index)}
              copied={copied}
              copy={copy}
            />
          );
        })}
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
