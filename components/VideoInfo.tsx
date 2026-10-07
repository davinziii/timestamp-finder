import { formatDuration } from "@/lib/timestamp";
import type { TranscriptSource, VideoInfo as Video } from "@/types/transcript";

export function VideoInfo({ video, source }: { video: Video; source: TranscriptSource }) {
  return (
    <div className="flex items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- plain YouTube thumbnail, no optimization needed */}
      <img
        src={video.thumbnailUrl}
        alt=""
        width={128}
        height={72}
        className="aspect-video w-24 shrink-0 rounded-md border border-line bg-surface-2 object-cover sm:w-32"
      />
      <div className="min-w-0">
        <a
          href={`https://www.youtube.com/watch?v=${video.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 font-medium leading-snug hover:underline"
        >
          {video.title}
        </a>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {video.author && <span>{video.author}</span>}
          {video.durationSeconds > 0 && (
            <>
              <span aria-hidden className="text-faint">·</span>
              <span className="font-mono tabular-nums">{formatDuration(video.durationSeconds)}</span>
            </>
          )}
          <span aria-hidden className="text-faint">·</span>
          <span>{source === "youtube-asr" ? "Auto-generated captions" : "Uploaded captions"}</span>
        </p>
      </div>
    </div>
  );
}
