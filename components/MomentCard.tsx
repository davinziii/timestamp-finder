"use client";

import Link from "next/link";
import type { ClipSpec } from "@/lib/clip";
import { formatTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl } from "@/lib/youtube";
import { CATEGORY_LABELS, type ClipPotential, type Moment } from "@/types/moments";
import { Button, buttonClass, CheckIcon, CopyIcon, DownloadIcon, PlayIcon } from "./Button";
import { clipLength, DownloadStatus } from "./TimestampResult";
import type { DownloadState } from "./useClipDownloads";

export const clipRange = (m: Moment) => `${formatTimestamp(m.start)}–${formatTimestamp(m.end)}`;

/** Link that opens the Timestamp Finder with this video, the key line and the clip range filled in. */
export function finderHref(videoUrl: string, m: Moment): string {
  const q = m.keyLine.split(" ").slice(0, 18).join(" ");
  const params = new URLSearchParams({ url: videoUrl, q, start: formatTimestamp(m.start), end: formatTimestamp(m.end) });
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
  selected,
  onSelect,
  spec,
  canDownload,
  download,
  onDownload,
  onCancel,
  copied,
  copy,
}: {
  moment: Moment;
  videoId: string;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  spec: ClipSpec;
  canDownload: boolean;
  download: DownloadState | undefined;
  onDownload: () => void;
  onCancel: () => void;
  copied: string | null;
  copy: (key: string, text: string) => void;
}) {
  const ts = formatTimestamp(m.start);
  const url = buildTimestampUrl(videoId, m.start);
  const k = (s: string) => `${m.rank}:${s}`;
  const busy = download?.status === "running" || download?.status === "queued";

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
            aria-label={`Select moment ${m.rank}`}
          />
          <span className="font-mono tracking-wider text-muted uppercase">
            Moment {m.rank} · {CATEGORY_LABELS[m.category]}
          </span>
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
          {clipRange(m)}
        </a>
        <span className="font-mono text-xs text-faint tabular-nums">{clipLength(m.end - m.start)}</span>
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
        <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm")}>
          <PlayIcon /> Watch on YouTube
        </a>
        <CopyButton label="Copy timestamp" done={copied === k("ts")} onClick={() => copy(k("ts"), ts)} />
        <CopyButton label="Copy clip range" done={copied === k("range")} onClick={() => copy(k("range"), clipRange(m))} />
        <Link href={finderHref(`https://www.youtube.com/watch?v=${videoId}`, m)} className={buttonClass("secondary", "sm")}>
          Use in Timestamp Finder
        </Link>
        {canDownload &&
          (busy ? (
            <Button onClick={onCancel}>Cancel</Button>
          ) : (
            <Button onClick={onDownload} title={`Download ${spec.name}.mp4`}>
              <DownloadIcon /> {download?.status === "done" ? "Download again" : "Download clip"}
            </Button>
          ))}
      </div>
      {download && <DownloadStatus state={download} />}
    </article>
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
