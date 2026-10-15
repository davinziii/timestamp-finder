"use client";

/**
 * Plays exactly a clip's range in an embedded player (privacy-enhanced
 * youtube-nocookie), so a range can be checked without leaving the page.
 * Rendered only when opened, so results don't load a player each.
 */
export function ClipPreview({ videoId, start, end }: { videoId: string; start: number; end: number }) {
  const params = new URLSearchParams({
    start: String(Math.floor(start)),
    end: String(Math.ceil(end)),
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
  });
  return (
    <div className="animate-rise mt-3 aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
      <iframe
        // Changing the range reloads the player at the new start.
        key={`${start}-${end}`}
        src={`https://www.youtube-nocookie.com/embed/${videoId}?${params}`}
        title="Clip preview"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        className="size-full"
      />
    </div>
  );
}
