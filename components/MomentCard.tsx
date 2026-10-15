"use client";

import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import type { ClipDraft, ClipSpec } from "@/lib/clip";
import { formatClipLength, formatTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl } from "@/lib/youtube";
import { CATEGORY_LABELS, type ClipPotential, type Moment } from "@/types/moments";
import { buttonClass, CopyButton, PlayIcon, type CopyFn } from "./Button";
import { ClipEditor } from "./ClipEditor";
import { ClipPreview } from "./ClipPreview";
import type { DownloadState, LocalDownloads } from "./useClipDownloads";

/** A moment's range after the user's adjustments (seconds). */
export interface Range {
  start: number;
  end: number;
}

export const formatRange = (r: Range) => `${formatTimestamp(r.start)}–${formatTimestamp(r.end)}`;

/** Link that opens the Timestamp Finder with this video, the key line and the clip range filled in. */
export function finderHref(videoId: string, m: Moment, r: Range): string {
  const params = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    q: m.keyLine.split(" ").slice(0, 18).join(" "),
    start: formatTimestamp(r.start),
    end: formatTimestamp(r.end),
  });
  return `/?${params}`;
}

const POTENTIAL_STYLES: Record<ClipPotential, string> = {
  High: "bg-ok-soft text-ok",
  Medium: "bg-warn-soft text-warn",
  Low: "bg-surface-2 text-muted",
};

export function MomentCard({
  moment: m,
  videoId,
  videoDuration,
  range,
  adjusted,
  selected,
  onSelect,
  draft,
  defaultName,
  onDraftChange,
  onReset,
  local,
  download,
  onDownload,
  onCancel,
  copied,
  copy,
}: {
  moment: Moment;
  videoId: string;
  videoDuration: number;
  /** The range in use: the suggestion, or the user's valid adjustment. */
  range: Range;
  adjusted: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  draft: ClipDraft;
  /** File name used while the name field is empty. */
  defaultName: string;
  onDraftChange: (d: ClipDraft) => void;
  onReset: () => void;
  local: LocalDownloads;
  download: DownloadState | undefined;
  onDownload: (spec: ClipSpec) => void;
  onCancel: () => void;
  copied: string | null;
  copy: CopyFn;
}) {
  const [previewing, setPreviewing] = useState(false);
  // Next keeps a page mounted (hidden) after navigating away; stop the player so it doesn't keep playing.
  useLayoutEffect(() => () => setPreviewing(false), []);
  const [editing, setEditing] = useState(false);
  const ts = formatTimestamp(range.start);
  const url = buildTimestampUrl(videoId, range.start);
  const k = (s: string) => `${m.rank}:${s}`;

  return (
    <article
      className={`animate-rise rounded-xl border bg-surface p-4 transition-colors sm:p-5 ${
        selected ? "border-accent/60" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          <span className="font-mono tracking-wider text-muted uppercase">
            Moment {m.rank} · {CATEGORY_LABELS[m.category]}
          </span>
          <span className="sr-only">Select this moment</span>
        </label>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${POTENTIAL_STYLES[m.potential]}`}
          title="Clip potential: an editorial estimate, not a prediction of views"
        >
          {m.potential} potential
        </span>
      </div>

      <h3 className="mt-2.5 text-[17px] leading-snug font-semibold text-pretty">{m.title}</h3>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-2xl font-semibold tracking-tight tabular-nums hover:text-accent"
          title={`Open at ${ts}`}
        >
          {formatRange(range)}
        </a>
        <span className="font-mono text-xs text-faint tabular-nums">{formatClipLength(range.end - range.start)}</span>
        {adjusted && (
          <span className="text-xs text-faint">
            Adjusted from {formatRange(m)} ·{" "}
            <button type="button" onClick={onReset} className="underline decoration-line-strong underline-offset-2 hover:text-fg">
              Reset
            </button>
          </span>
        )}
      </div>

      <p className="mt-3 text-[15px] leading-relaxed text-pretty">&ldquo;{m.keyLine}&rdquo;</p>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        <span className="font-medium text-fg">Why it&rsquo;s interesting: </span>
        {m.why}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        <span className="font-medium text-fg">Clip potential ({m.potential.toLowerCase()}): </span>
        {m.potentialReason}
      </p>

      {m.signals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.signals.map((s) => (
            <span key={s} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted">
              {s}
            </span>
          ))}
        </div>
      )}

      <details className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
        <summary className="cursor-pointer text-xs font-medium text-muted select-none">Transcript excerpt</summary>
        <p className="mt-2 leading-relaxed text-pretty text-fg/85">{m.excerpt}</p>
        {m.transcriptNote && <p className="mt-2 text-xs text-warn">{m.transcriptNote}</p>}
      </details>

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
          Watch on YouTube
        </a>
        <CopyButton label="Copy timestamp" copyKey={k("ts")} text={ts} copied={copied} copy={copy} />
        <CopyButton label="Copy clip range" copyKey={k("range")} text={formatRange(range)} copied={copied} copy={copy} />
        <Link href={finderHref(videoId, m, range)} className={buttonClass("secondary", "sm")}>
          Use in Timestamp Finder
        </Link>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          aria-expanded={editing}
          className={buttonClass(editing ? "secondary" : "ghost", "sm")}
        >
          {editing ? "Close editor" : local.status === "ready" ? "Adjust & download" : "Adjust clip"}
        </button>
      </div>

      {previewing && <ClipPreview videoId={videoId} start={range.start} end={range.end} />}

      {(editing || download) && (
        <ClipEditor
          videoId={videoId}
          videoDuration={videoDuration}
          draft={draft}
          onChange={onDraftChange}
          fallbackName={defaultName}
          quality="1080"
          qualityControl={null}
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
