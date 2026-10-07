"use client";

import { CLIP_LIMITS, ytDlpCommand, type ClipQuality, type ClipSpec } from "@/lib/clip";
import { MATCHING } from "@/lib/config";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl } from "@/lib/youtube";
import type { Match, SentenceResult } from "@/types/search";
import { Button, buttonClass, CheckIcon, CopyIcon, DownloadIcon, PlayIcon } from "./Button";
import { QualityToggle } from "./QualityToggle";
import { formatBytes, revealClip, type DownloadState } from "./useClipDownloads";

type CopyFn = (key: string, text: string) => void;

export interface ClipDraft {
  name: string;
  start: string;
  end: string;
  /** This clip's own resolution; undefined = follow the global default. */
  quality?: ClipQuality;
}

export function TimestampResult({
  result,
  videoId,
  selected,
  onSelect,
  draft,
  onDraftChange,
  quality,
  onQualityChange,
  qualityLabels,
  qualityHints,
  cpuEncoding,
  canDownload,
  download,
  onDownload,
  onCancel,
  copied,
  copy,
}: {
  result: SentenceResult;
  videoId: string;
  /** Index into [best, ...alternatives] that the user picked. */
  selected: number;
  onSelect: (i: number) => void;
  draft: ClipDraft | null;
  onDraftChange: (d: ClipDraft) => void;
  quality: ClipQuality;
  /** null when the video has nothing above 1080p. */
  onQualityChange: ((q: ClipQuality) => void) | null;
  qualityLabels: Record<ClipQuality, string>;
  qualityHints: Record<ClipQuality, string>;
  cpuEncoding: boolean;
  canDownload: boolean;
  download: DownloadState | undefined;
  onDownload: (spec: ClipSpec) => void;
  onCancel: () => void;
  copied: string | null;
  copy: CopyFn;
}) {
  const n = result.index + 1;

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
            ({Math.round(weak.score * 100)}%) — &ldquo;{weak.text}&rdquo;
          </p>
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
        <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm")}>
          <PlayIcon /> Watch at {ts}
        </a>
        <CopyButton label="Copy timestamp" done={copied === k("ts")} onClick={() => copy(k("ts"), ts)} />
        <CopyButton label="Copy YouTube link" done={copied === k("url")} onClick={() => copy(k("url"), url)} />
      </div>

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
        <ClipPanel
          draft={draft}
          onChange={onDraftChange}
          videoId={videoId}
          quality={quality}
          onQualityChange={onQualityChange}
          qualityLabels={qualityLabels}
          qualityHints={qualityHints}
          cpuEncoding={cpuEncoding}
          canDownload={canDownload}
          download={download}
          onDownload={onDownload}
          onCancel={onCancel}
          copyKey={k}
          copied={copied}
          copy={copy}
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

function CopyButton({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) {
  return (
    <Button onClick={onClick} aria-live="polite">
      {done ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon />}
      {done ? "Copied" : label}
    </Button>
  );
}

function ClipPanel({
  draft,
  onChange,
  videoId,
  quality,
  onQualityChange,
  qualityLabels,
  qualityHints,
  cpuEncoding,
  canDownload,
  download,
  onDownload,
  onCancel,
  copyKey,
  copied,
  copy,
}: {
  draft: ClipDraft;
  onChange: (d: ClipDraft) => void;
  videoId: string;
  quality: ClipQuality;
  onQualityChange: ((q: ClipQuality) => void) | null;
  qualityLabels: Record<ClipQuality, string>;
  qualityHints: Record<ClipQuality, string>;
  cpuEncoding: boolean;
  canDownload: boolean;
  download: DownloadState | undefined;
  onDownload: (spec: ClipSpec) => void;
  onCancel: () => void;
  copyKey: (s: string) => string;
  copied: string | null;
  copy: CopyFn;
}) {
  const s = parseTimestamp(draft.start);
  const e = parseTimestamp(draft.end);
  const rangeOk = s !== null && e !== null && e > s;
  const tooLong = rangeOk && e - s > CLIP_LIMITS.maxDurationSeconds;
  const valid = rangeOk && !tooLong && draft.name.trim().length > 0;
  const range = rangeOk ? `${formatTimestamp(s)} - ${formatTimestamp(e)}` : "";
  const spec: ClipSpec | null = valid ? { videoId, start: s, end: e, name: draft.name, quality } : null;
  const busy = download?.status === "running" || download?.status === "queued";

  return (
    <div className="mt-4 rounded-lg bg-surface-2 p-3">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">Clip name</span>
        <input
          value={draft.name}
          onChange={(ev) => onChange({ ...draft, name: ev.target.value })}
          maxLength={CLIP_LIMITS.maxNameLength}
          spellCheck={false}
          disabled={busy}
          aria-invalid={!draft.name.trim()}
          className={`h-8 w-full rounded-md border bg-surface px-2 text-[13px] outline-none focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60 ${
            draft.name.trim() ? "border-line focus:border-line-strong" : "border-bad"
          }`}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <TimeField
          label="Clip start"
          value={draft.start}
          onChange={(v) => onChange({ ...draft, start: v })}
          invalid={s === null}
        />
        <TimeField
          label="End"
          value={draft.end}
          onChange={(v) => onChange({ ...draft, end: v })}
          invalid={e === null || (s !== null && e <= s)}
        />
        {rangeOk && (
          <p className={`pb-1.5 font-mono text-xs tabular-nums ${tooLong ? "text-bad" : "text-faint"}`}>
            {clipLength(e - s)}
            {tooLong && ` · max ${CLIP_LIMITS.maxDurationSeconds / 60} min`}
          </p>
        )}
        {onQualityChange && (
          <div className="pb-0.5">
            <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">Resolution</span>
            <QualityToggle
              small
              value={quality}
              onChange={onQualityChange}
              labels={qualityLabels}
              hints={qualityHints}
            />
          </div>
        )}
        {rangeOk && !tooLong && canDownload && cpuEncoding && (
          <p className="pb-1.5 text-xs text-faint">≈ {encodeEstimate(e - s, quality)} to make</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {canDownload &&
          (busy ? (
            <Button onClick={onCancel}>Cancel</Button>
          ) : (
            <Button variant="primary" disabled={!spec} onClick={() => spec && onDownload(spec)}>
              <DownloadIcon /> {download?.status === "done" ? "Download again" : "Download clip"}
            </Button>
          ))}
        <Button disabled={!rangeOk} onClick={() => copy(copyKey("clip"), range)}>
          {copied === copyKey("clip") ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon />}
          {copied === copyKey("clip") ? "Copied" : "Copy clip range"}
        </Button>
        <Button disabled={!spec} onClick={() => spec && copy(copyKey("cmd"), ytDlpCommand(spec))}>
          {copied === copyKey("cmd") ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon />}
          {copied === copyKey("cmd") ? "Copied" : "Copy download command"}
        </Button>
        {rangeOk && (
          <a href={buildTimestampUrl(videoId, s)} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
            <PlayIcon /> Preview
          </a>
        )}
      </div>

      {download && <DownloadStatus state={download} />}
    </div>
  );
}

/** 60 -> "1:00", 45 -> "45s" */
function clipLength(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Rough CPU (x264) time to download + encode, measured on a 12-thread machine:
 * ~3.3x the clip length at 1080p, ~11x at 4K.
 */
function encodeEstimate(seconds: number, quality: ClipQuality): string {
  const total = seconds * (quality === "best" ? 11 : 3.3);
  if (total < 60) return `${Math.max(10, Math.round(total / 10) * 10)} s`;
  return `${Math.round(total / 60)} min`;
}

function DownloadStatus({ state }: { state: DownloadState }) {
  if (state.status === "queued") {
    return <p className="mt-3 text-xs text-faint">Waiting in queue…</p>;
  }
  if (state.status === "running") {
    return (
      <div className="mt-3" aria-live="polite">
        <div className="flex justify-between text-xs text-muted">
          <span>{state.message}</span>
          {state.percent !== null && <span className="font-mono tabular-nums">{state.percent}%</span>}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
          {state.percent === null ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
          ) : (
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${state.percent}%` }} />
          )}
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-3 text-xs text-bad">
        Download failed: {state.message}
      </p>
    );
  }
  const fileName = state.file.split(/[\\/]/).pop();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-live="polite">
      <span className="inline-flex items-center gap-1 font-medium text-ok">
        <CheckIcon className="size-3.5" /> Saved
      </span>
      <span className="min-w-0 truncate font-mono text-muted" title={state.file}>
        {fileName}
      </span>
      <span className="font-mono text-faint">{formatBytes(state.sizeBytes)}</span>
      <button
        type="button"
        onClick={() => revealClip(state.file)}
        className="text-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
      >
        Show in folder
      </button>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">{label}</span>
      <input
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        inputMode="numeric"
        spellCheck={false}
        aria-invalid={invalid}
        className={`h-8 w-24 rounded-md border bg-surface px-2 font-mono text-[13px] tabular-nums outline-none focus:ring-4 focus:ring-[var(--ring)] ${
          invalid ? "border-bad" : "border-line focus:border-line-strong"
        }`}
      />
    </label>
  );
}
