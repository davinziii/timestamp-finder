"use client";

import { useLayoutEffect, useState } from "react";
import { checkRange, DEFAULT_CLIP_SECONDS, type ClipDraft, type ClipQuality, type ClipSpec } from "@/lib/clip";
import { MATCHING } from "@/lib/config";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl } from "@/lib/youtube";
import type { Match, SentenceResult } from "@/types/search";
import { buttonClass, CheckIcon, CopyButton, PlayIcon, type CopyFn } from "./Button";
import { ClipEditor, type QualityControl } from "./ClipEditor";
import { ClipPreview, useLastValidRange } from "./ClipPreview";
import type { DownloadState, LocalDownloads } from "./useClipDownloads";

export function TimestampResult({
  result,
  videoId,
  videoDuration,
  selected,
  onSelect,
  draft,
  onDraftChange,
  quality,
  qualityControl,
  local,
  download,
  onDownload,
  onCancel,
  copied,
  copy,
}: {
  result: SentenceResult;
  videoId: string;
  videoDuration: number;
  /** Index into [best, ...alternatives] that the user picked. */
  selected: number;
  onSelect: (i: number) => void;
  draft: ClipDraft | null;
  onDraftChange: (d: ClipDraft) => void;
  quality: ClipQuality;
  /** null when the video has nothing above 1080p. */
  qualityControl: QualityControl | null;
  local: LocalDownloads;
  download: DownloadState | undefined;
  onDownload: (spec: ClipSpec) => void;
  onCancel: () => void;
  copied: string | null;
  copy: CopyFn;
}) {
  const n = result.index + 1;
  const [previewing, setPreviewing] = useState(false);
  // Next keeps a page mounted (hidden) after navigating away; stop the player so it doesn't keep playing.
  useLayoutEffect(() => () => setPreviewing(false), []);

  // Preview the clip as edited below; while a time is half-typed, keep the last valid range.
  const chosen = result.best ? ([result.best, ...result.alternatives][selected] ?? result.best) : null;
  const ds = draft ? parseTimestamp(draft.start) : null;
  const de = draft ? parseTimestamp(draft.end) : null;
  const edited =
    draft && ds !== null && de !== null && !checkRange(draft.start, draft.end, videoDuration) ? { start: ds, end: de } : null;
  const matchStart = Math.floor(chosen?.start ?? 0);
  const preview = useLastValidRange(edited, {
    start: matchStart,
    end: Math.min(matchStart + DEFAULT_CLIP_SECONDS, videoDuration || Infinity),
  });

  if (!result.found || !result.best) {
    const weak = result.best && result.best.score >= 0.4 ? result.best : null;
    return (
      <article className="animate-rise rounded-xl border border-line bg-surface p-4 sm:p-5">
        <Heading n={n} found={false} />
        <Quote text={result.query} muted />
        <p className="mt-3 text-sm font-medium">No strong match found.</p>
        <p className="mt-0.5 text-[13px] text-muted">Try using fewer words or slightly different wording.</p>
        {weak && (
          <p className="mt-3 text-xs text-faint">
            Closest weak match:{" "}
            <a
              href={buildTimestampUrl(videoId, weak.start)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
            >
              {formatTimestamp(weak.start)}
            </a>{" "}
            ({Math.round(weak.score * 100)}%) — &ldquo;{weak.text}&rdquo;{" "}
            <button
              type="button"
              onClick={() => setPreviewing((p) => !p)}
              aria-pressed={previewing}
              className="text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
            >
              {previewing ? "Hide preview" : "Preview"}
            </button>
          </p>
        )}
        {weak && previewing && (
          <ClipPreview videoId={videoId} start={weak.start} end={Math.min(weak.start + 30, videoDuration || Infinity)} />
        )}
      </article>
    );
  }

  const matches = [result.best, ...result.alternatives];
  const match = matches[selected] ?? result.best;
  const ts = formatTimestamp(match.start);
  const url = buildTimestampUrl(videoId, match.start);
  const k = (s: string) => `${result.index}:${s}`;

  return (
    <article className="animate-rise rounded-xl border border-line bg-surface p-4 sm:p-5">
      <Heading n={n} found />
      <Quote text={result.query} />

      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-3xl font-semibold tracking-tight tabular-nums hover:text-accent"
          title={`Open at ${ts}`}
        >
          {ts}
        </a>
        <ScoreBadge score={match.score} />
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        <span className="text-faint">Heard: </span>&ldquo;{match.text}&rdquo;
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPreviewing((p) => !p)}
          aria-pressed={previewing}
          className={buttonClass("primary", "sm")}
        >
          <PlayIcon /> {previewing ? "Hide preview" : "Preview clip"}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
          Watch at {ts}
        </a>
        <CopyButton label="Copy timestamp" copyKey={k("ts")} text={ts} copied={copied} copy={copy} />
        <CopyButton label="Copy YouTube link" copyKey={k("url")} text={url} copied={copied} copy={copy} />
      </div>

      {previewing && <ClipPreview videoId={videoId} start={preview.start} end={preview.end} />}

      {result.alternatives.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-medium tracking-wider text-faint uppercase">
            {matches.length} possible moments — pick one
          </p>
          <div className="flex flex-wrap gap-1.5">
            {matches.map((m, i) => (
              <MatchChip key={i} m={m} active={i === selected} best={i === 0} onClick={() => onSelect(i)} />
            ))}
          </div>
        </div>
      )}

      {draft && (
        <ClipEditor
          videoId={videoId}
          videoDuration={videoDuration}
          draft={draft}
          onChange={onDraftChange}
          quality={quality}
          qualityControl={qualityControl}
          local={local}
          download={download}
          onDownload={onDownload}
          onCancel={onCancel}
          copyKey={k}
          copied={copied}
          copy={copy}
          showPreview={false}
        />
      )}
    </article>
  );
}

function Heading({ n, found }: { n: number; found: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      <span
        className={`grid size-5 place-items-center rounded-full ${found ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}
        aria-hidden
      >
        {found ? (
          <CheckIcon className="size-3" />
        ) : (
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m4.5 4.5 7 7m0-7-7 7" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="font-mono tracking-wider text-muted uppercase">Sentence {String(n).padStart(2, "0")}</span>
      <span className="sr-only">{found ? "found" : "not found"}</span>
    </div>
  );
}

function Quote({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <p className={`mt-2.5 text-[15px] leading-relaxed text-pretty ${muted ? "text-muted" : "text-fg"}`}>
      &ldquo;{text}&rdquo;
    </p>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const strong = score >= MATCHING.strongThreshold;
  return (
    <span
      className={`mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        strong ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
      }`}
      title={strong ? "Strong match" : "Likely match. Worth a quick check."}
    >
      <span className="font-mono tabular-nums">{pct}%</span> {strong ? "match" : "likely match"}
    </span>
  );
}

function MatchChip({ m, active, best, onClick }: { m: Match; active: boolean; best: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors ${
        active ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      <span className="font-mono font-medium tabular-nums">{formatTimestamp(m.start)}</span>
      <span className="font-mono tabular-nums text-faint">{Math.round(m.score * 100)}%</span>
      {best && <span className="text-[10px] tracking-wide text-faint uppercase">best</span>}
    </button>
  );
}
