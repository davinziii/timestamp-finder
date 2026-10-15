"use client";

import { useLayoutEffect, useState } from "react";
import {
  checkRange,
  CLIP_LIMITS,
  draftToSpec,
  ytDlpCommand,
  type ClipDraft,
  type ClipQuality,
  type ClipSpec,
} from "@/lib/clip";
import { formatClipLength, formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { Button, CheckIcon, CopyButton, DownloadIcon, PlayIcon, type CopyFn } from "./Button";
import { ClipPreview } from "./ClipPreview";
import { QualityToggle } from "./QualityToggle";
import { formatBytes, revealClip, type DownloadState, type LocalDownloads } from "./useClipDownloads";

export interface QualityControl {
  labels: Record<ClipQuality, string>;
  hints: Record<ClipQuality, string>;
  onChange: (q: ClipQuality) => void;
}

/**
 * Name, start/end, resolution, preview and download for one clip. Used by
 * every Timestamp Finder result, the "Download or trim" panel and each Best
 * Moments card, so they all validate and download the same way.
 */
export function ClipEditor({
  videoId,
  videoDuration,
  draft,
  onChange,
  fallbackName,
  quality,
  qualityControl,
  local,
  download,
  onDownload,
  onCancel,
  copyKey,
  copied,
  copy,
  showPreview = true,
}: {
  videoId: string;
  /** 0 when unknown. */
  videoDuration: number;
  draft: ClipDraft;
  onChange: (d: ClipDraft) => void;
  /** Used (and shown as the placeholder) while the name field is empty. */
  fallbackName?: string;
  /** The resolution this clip will use. */
  quality: ClipQuality;
  /** null when the video has nothing above 1080p. */
  qualityControl: QualityControl | null;
  local: LocalDownloads;
  download: DownloadState | undefined;
  onDownload: (spec: ClipSpec) => void;
  onCancel: () => void;
  copyKey: (s: string) => string;
  copied: string | null;
  copy: CopyFn;
  /** false when the surrounding card already has its own preview. */
  showPreview?: boolean;
}) {
  const [previewing, setPreviewing] = useState(false);
  // Next keeps a page mounted (hidden) after navigating away; stop the player so it doesn't keep playing.
  useLayoutEffect(() => () => setPreviewing(false), []);
  const s = parseTimestamp(draft.start);
  const e = parseTimestamp(draft.end);
  const rangeError = checkRange(draft.start, draft.end, videoDuration);
  const rangeOk = s !== null && e !== null && !rangeError;
  const nameMissing = !draft.name.trim() && !fallbackName;
  const spec = nameMissing ? null : draftToSpec(videoId, draft, quality, videoDuration, fallbackName);
  const busy = download?.status === "running" || download?.status === "queued";
  const canDownload = local.status === "ready";

  return (
    <div className="mt-4 rounded-lg bg-surface-2 p-3">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">Clip name</span>
        <input
          value={draft.name}
          onChange={(ev) => onChange({ ...draft, name: ev.target.value })}
          placeholder={fallbackName}
          maxLength={CLIP_LIMITS.maxNameLength}
          spellCheck={false}
          disabled={busy}
          aria-invalid={nameMissing}
          className={`h-8 w-full rounded-md border bg-surface px-2 text-[13px] outline-none placeholder:text-faint focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60 ${
            nameMissing ? "border-bad" : "border-line focus:border-line-strong"
          }`}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <TimeField
          label="Clip start"
          value={draft.start}
          onChange={(v) => onChange({ ...draft, start: v })}
          invalid={rangeError?.field === "start"}
          disabled={busy}
        />
        <TimeField
          label="End"
          value={draft.end}
          onChange={(v) => onChange({ ...draft, end: v })}
          invalid={rangeError?.field === "end"}
          disabled={busy}
        />
        {s !== null && e !== null && e > s && (
          <p className={`pb-1.5 font-mono text-xs tabular-nums ${rangeError ? "text-bad" : "text-faint"}`}>
            {formatClipLength(e - s)}
          </p>
        )}
        {qualityControl && (
          <div className="pb-0.5">
            <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">Resolution</span>
            <QualityToggle
              small
              value={quality}
              onChange={qualityControl.onChange}
              labels={qualityControl.labels}
              hints={qualityControl.hints}
            />
          </div>
        )}
        {rangeOk && canDownload && local.encoder !== "h264_nvenc" && (
          <p className="pb-1.5 text-xs text-faint">≈ {encodeEstimate(e - s, quality)} to make</p>
        )}
      </div>
      {rangeError && (
        <p role="alert" className="mt-2 text-xs text-bad">
          {rangeError.message}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canDownload &&
          (busy ? (
            <Button onClick={onCancel}>Cancel</Button>
          ) : (
            <Button variant="primary" disabled={!spec} onClick={() => spec && onDownload(spec)}>
              <DownloadIcon /> {download?.status === "done" ? "Download again" : "Download clip"}
            </Button>
          ))}
        {showPreview && (
          <Button
            variant={previewing ? "secondary" : "ghost"}
            disabled={!rangeOk}
            onClick={() => setPreviewing((p) => !p)}
            aria-pressed={previewing}
          >
            <PlayIcon /> {previewing ? "Hide preview" : "Preview clip"}
          </Button>
        )}
        <CopyButton
          label="Copy clip range"
          copyKey={copyKey("clip")}
          text={rangeOk ? `${formatTimestamp(s)}–${formatTimestamp(e)}` : ""}
          copied={copied}
          copy={copy}
        />
        <CopyButton
          label="Copy download command"
          copyKey={copyKey("cmd")}
          text={spec ? ytDlpCommand(spec) : ""}
          copied={copied}
          copy={copy}
        />
      </div>

      {showPreview && previewing && rangeOk && <ClipPreview videoId={videoId} start={s} end={e} />}
      {download && <DownloadStatus state={download} />}
      {!canDownload && local.status === "unavailable" && (
        <p className="mt-3 text-xs text-faint">Run the copied command with yt-dlp to save the clip. {local.reason}</p>
      )}
    </div>
  );
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

export function DownloadStatus({ state }: { state: DownloadState }) {
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

export function TimeField({
  label,
  value,
  onChange,
  invalid,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">{label}</span>
      <input
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        inputMode="numeric"
        placeholder="0:00"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid}
        className={`h-8 w-24 rounded-md border bg-surface px-2 font-mono text-[13px] tabular-nums outline-none placeholder:text-faint focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60 ${
          invalid ? "border-bad" : "border-line focus:border-line-strong"
        }`}
      />
    </label>
  );
}
