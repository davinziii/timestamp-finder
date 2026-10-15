"use client";

import { useState } from "react";
import {
  CLIP_LIMITS,
  CLIP_QUALITY_LABELS,
  offersAbove1080,
  resolutionLabel,
  sanitizeClipName,
  ytDlpCommand,
  type ClipQuality,
  type ClipSpec,
} from "@/lib/clip";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { buildTimestampUrl, extractVideoId } from "@/lib/youtube";
import { Button, buttonClass, CheckIcon, CopyIcon, DownloadIcon, PlayIcon } from "./Button";
import { QualityToggle } from "./QualityToggle";
import { clipLength, DownloadStatus, TimeField } from "./TimestampResult";
import { useClipDownloads, useLocalDownloads } from "./useClipDownloads";
import { useCopy } from "./useCopy";

const SEGMENT = 0;
const FULL = 1;

export interface TrimRange {
  start: string;
  end: string;
}

/**
 * Download any time range of the video in the URL field, or the whole video,
 * without searching for a sentence first. Uses the same yt-dlp workflow as
 * the per-result clip panels.
 */
export function TrimPanel({
  url,
  video,
  range,
  onRangeChange,
  open,
  onOpenChange,
}: {
  url: string;
  /** Known once a search has loaded the video. */
  video: { videoId: string; title: string; durationSeconds: number; maxHeight: number } | null;
  range: TrimRange;
  onRangeChange: (r: TrimRange) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { copied, copy } = useCopy();
  const local = useLocalDownloads();
  const downloads = useClipDownloads();
  const [name, setName] = useState("");
  const [quality, setQuality] = useState<ClipQuality>("1080");

  const videoId = extractVideoId(url);
  const known = video && video.videoId === videoId ? video : null;
  const duration = known?.durationSeconds ?? 0;
  const canGoHigher = offersAbove1080(known?.maxHeight ?? 0);
  const q: ClipQuality = canGoHigher ? quality : "1080";
  const fileName = sanitizeClipName(name.trim() || (known ? known.title : "clip"));

  const s = parseTimestamp(range.start);
  const e = parseTimestamp(range.end);
  // Which field is wrong, and why. Negative times never parse, so they land here too.
  let rangeError: { field: "start" | "end"; message: string } | null = null;
  if (range.start.trim() && s === null) rangeError = { field: "start", message: "Enter the start as a time, like 1:30 or 1:02:30." };
  else if (range.end.trim() && e === null) rangeError = { field: "end", message: "Enter the end as a time, like 2:30 or 1:04:00." };
  else if (s !== null && e !== null && e <= s) rangeError = { field: "end", message: "The end time must be later than the start time." };
  else if (s !== null && e !== null && e - s > CLIP_LIMITS.maxDurationSeconds)
    rangeError = {
      field: "end",
      message: `Segments can be at most ${CLIP_LIMITS.maxDurationSeconds / 60} minutes. Use “Download full video” for longer parts.`,
    };
  else if (duration > 0 && s !== null && s >= duration)
    rangeError = { field: "start", message: `The video is only ${formatTimestamp(duration)} long.` };
  else if (duration > 0 && e !== null && e > duration + 1)
    rangeError = { field: "end", message: `The video ends at ${formatTimestamp(duration)}.` };

  const segment: ClipSpec | null =
    videoId && s !== null && e !== null && !rangeError
      ? {
          videoId,
          start: s,
          end: e,
          // Keep the range in the name even when a long title hits the length limit.
          name: `${fileName.slice(0, CLIP_LIMITS.maxNameLength - 24).trim()} (${formatTimestamp(s)}-${formatTimestamp(e)})`.replace(/:/g, "."),
          quality: q,
        }
      : null;
  const full: ClipSpec | null = videoId
    ? { videoId, start: 0, end: duration, name: fileName, quality: q, full: true }
    : null;
  const ready = local.status === "ready";
  const busy = (k: number) => ["running", "queued"].includes(downloads.states[k]?.status ?? "");

  return (
    <details
      open={open}
      onToggle={(ev) => onOpenChange((ev.target as HTMLDetailsElement).open)}
      className="group rounded-xl border border-line bg-surface shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 select-none sm:px-5">
        <span>
          <span className="block text-[13px] font-medium">Download or trim this video</span>
          <span className="mt-0.5 block text-xs text-faint">Any time range, or the full video, without searching first.</span>
        </span>
        <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      <div className="space-y-4 border-t border-line p-4 sm:px-5">
        {!videoId ? (
          <p className="text-[13px] text-muted">Enter a valid YouTube URL above to download or trim it.</p>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">File name</span>
              <input
                value={name}
                onChange={(ev) => setName(ev.target.value)}
                placeholder={known ? sanitizeClipName(known.title) : "clip"}
                maxLength={CLIP_LIMITS.maxNameLength}
                spellCheck={false}
                className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] outline-none placeholder:text-faint focus:border-line-strong focus:ring-4 focus:ring-[var(--ring)]"
              />
            </label>

            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-[13px] font-medium">Segment</p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <TimeField
                  label="Start"
                  value={range.start}
                  onChange={(v) => onRangeChange({ ...range, start: v })}
                  invalid={rangeError?.field === "start"}
                />
                <TimeField
                  label="End"
                  value={range.end}
                  onChange={(v) => onRangeChange({ ...range, end: v })}
                  invalid={rangeError?.field === "end"}
                />
                {s !== null && e !== null && e > s && (
                  <p className="pb-1.5 font-mono text-xs text-faint tabular-nums">{clipLength(e - s)} selected</p>
                )}
                {canGoHigher && (
                  <div className="pb-0.5">
                    <span className="mb-1 block text-[11px] font-medium tracking-wider text-faint uppercase">Resolution</span>
                    <QualityToggle
                      small
                      value={quality}
                      onChange={setQuality}
                      labels={{ "1080": "1080p", best: known?.maxHeight ? resolutionLabel(known.maxHeight) : "Best" }}
                      hints={{ "1080": CLIP_QUALITY_LABELS["1080"].hint, best: CLIP_QUALITY_LABELS.best.hint }}
                    />
                  </div>
                )}
              </div>
              {rangeError && (
                <p role="alert" className="mt-2 text-xs text-bad">
                  {rangeError.message}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {ready &&
                  (busy(SEGMENT) ? (
                    <Button onClick={() => downloads.cancel(SEGMENT)}>Cancel</Button>
                  ) : (
                    <Button variant="primary" disabled={!segment} onClick={() => segment && downloads.download(SEGMENT, segment)}>
                      <DownloadIcon /> Download segment
                    </Button>
                  ))}
                <Button disabled={!segment} onClick={() => segment && copy("seg-cmd", ytDlpCommand(segment))}>
                  {copied === "seg-cmd" ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon />}
                  {copied === "seg-cmd" ? "Copied" : "Copy download command"}
                </Button>
                {s !== null && (
                  <a href={buildTimestampUrl(videoId, s)} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
                    <PlayIcon /> Preview
                  </a>
                )}
              </div>
              {downloads.states[SEGMENT] && <DownloadStatus state={downloads.states[SEGMENT]} />}
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Only the selected range is downloaded, then re-encoded so the clip starts on the exact frame.
              </p>
            </div>

            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-[13px] font-medium">
                Full video{duration > 0 && <span className="font-normal text-faint"> · {formatTimestamp(duration)}</span>}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {ready &&
                  (busy(FULL) ? (
                    <Button onClick={() => downloads.cancel(FULL)}>Cancel</Button>
                  ) : (
                    <Button variant="primary" disabled={!full} onClick={() => full && downloads.download(FULL, full)}>
                      <DownloadIcon /> Download full video
                    </Button>
                  ))}
                <Button disabled={!full} onClick={() => full && copy("full-cmd", ytDlpCommand(full))}>
                  {copied === "full-cmd" ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon />}
                  {copied === "full-cmd" ? "Copied" : "Copy download command"}
                </Button>
              </div>
              {downloads.states[FULL] && <DownloadStatus state={downloads.states[FULL]} />}
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Saved as YouTube serves it, without re-encoding. Long videos can take several minutes and use a lot of disk space.
              </p>
            </div>

            <p className="text-xs leading-relaxed text-faint">
              {ready ? (
                <>
                  Saves to <span className="font-mono">{local.folder}</span>.
                </>
              ) : local.status === "checking" ? (
                "Checking for yt-dlp…"
              ) : (
                <>Copy the commands and run them with yt-dlp. {local.reason}</>
              )}{" "}
              Only download videos you have permission to use.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
