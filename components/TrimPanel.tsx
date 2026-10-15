"use client";

import { useState } from "react";
import {
  CLIP_QUALITY_LABELS,
  offersAbove1080,
  resolutionLabel,
  sanitizeClipName,
  ytDlpCommand,
  type ClipDraft,
  type ClipQuality,
  type ClipSpec,
} from "@/lib/clip";
import { formatTimestamp, parseTimestamp } from "@/lib/timestamp";
import { extractVideoId } from "@/lib/youtube";
import type { VideoInfo } from "@/types/transcript";
import { Button, CopyButton, DownloadIcon } from "./Button";
import { ClipEditor, DownloadStatus } from "./ClipEditor";
import { useClipDownloads, useLocalDownloads } from "./useClipDownloads";
import { useCopy } from "./useCopy";

const SEGMENT = 0;
const FULL = 1;

/**
 * Download any time range of the video in the URL field, or the whole video,
 * without searching for a sentence first. Same editor and yt-dlp workflow as
 * the per-result clips.
 */
export function TrimPanel({
  url,
  video,
  draft,
  onDraftChange,
  open,
  onOpenChange,
}: {
  url: string;
  /** Known once a search has loaded the video. */
  video: VideoInfo | null;
  draft: ClipDraft;
  onDraftChange: (d: ClipDraft) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { copied, copy } = useCopy();
  const local = useLocalDownloads();
  const downloads = useClipDownloads();
  const [quality, setQuality] = useState<ClipQuality>("1080");

  const videoId = extractVideoId(url);
  const known = video && video.videoId === videoId ? video : null;
  const duration = known?.durationSeconds ?? 0;
  const canGoHigher = offersAbove1080(known?.maxHeight ?? 0);
  const q: ClipQuality = canGoHigher ? quality : "1080";
  const title = sanitizeClipName(known?.title ?? "clip");

  // Default segment name: title + range, with room for the range under the length limit.
  const s = parseTimestamp(draft.start);
  const e = parseTimestamp(draft.end);
  const segmentName =
    s !== null && e !== null && e > s
      ? `${title.slice(0, 56).trim()} (${formatTimestamp(s)}-${formatTimestamp(e)})`.replace(/:/g, ".")
      : title;

  const full: ClipSpec | null = videoId ? { videoId, start: 0, end: duration, name: title, quality: q, full: true } : null;
  const fullBusy = ["running", "queued"].includes(downloads.states[FULL]?.status ?? "");

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

      <div className="border-t border-line px-4 pb-4 sm:px-5">
        {!videoId ? (
          <p className="pt-4 text-[13px] text-muted">Enter a valid YouTube URL above to download or trim it.</p>
        ) : (
          <>
            <ClipEditor
              videoId={videoId}
              videoDuration={duration}
              draft={draft}
              onChange={onDraftChange}
              fallbackName={segmentName}
              quality={q}
              qualityControl={
                canGoHigher
                  ? {
                      labels: { "1080": "1080p", best: known?.maxHeight ? resolutionLabel(known.maxHeight) : "Best" },
                      hints: { "1080": CLIP_QUALITY_LABELS["1080"].hint, best: CLIP_QUALITY_LABELS.best.hint },
                      onChange: setQuality,
                    }
                  : null
              }
              local={local}
              download={downloads.states[SEGMENT]}
              onDownload={(spec) => downloads.download(SEGMENT, spec)}
              onCancel={() => downloads.cancel(SEGMENT)}
              copyKey={(k) => `trim:${k}`}
              copied={copied}
              copy={copy}
            />
            <p className="mt-2 text-xs leading-relaxed text-faint">
              Only the selected range is downloaded, then re-encoded so the clip starts on the exact frame.
              {!known && " Run a search to also check the range against the video's length."}
            </p>

            <div className="mt-4 rounded-lg bg-surface-2 p-3">
              <p className="text-[13px] font-medium">
                Full video{duration > 0 && <span className="font-normal text-faint"> · {formatTimestamp(duration)}</span>}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {local.status === "ready" &&
                  (fullBusy ? (
                    <Button onClick={() => downloads.cancel(FULL)}>Cancel</Button>
                  ) : (
                    <Button variant="primary" disabled={!full} onClick={() => full && downloads.download(FULL, full)}>
                      <DownloadIcon /> Download full video
                    </Button>
                  ))}
                <CopyButton
                  label="Copy download command"
                  copyKey="trim:full-cmd"
                  text={full ? ytDlpCommand(full) : ""}
                  copied={copied}
                  copy={copy}
                />
              </div>
              {downloads.states[FULL] && <DownloadStatus state={downloads.states[FULL]} />}
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Saved as YouTube serves it, without re-encoding. Long videos can take several minutes and a lot of disk space.
              </p>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-faint">
              {local.status === "ready" ? (
                <>
                  Saves to <span className="font-mono">{local.folder}</span>.{" "}
                </>
              ) : null}
              Only download videos you have permission to use.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
