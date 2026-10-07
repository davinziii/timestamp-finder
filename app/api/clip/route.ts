import { validateClip, type ClipQuality, type ClipSpec } from "@/lib/clip";
import {
  clipsDir,
  downloadClip,
  isLocalRequest,
  localDownloadsEnabled,
  ytDlpVersion,
  videoEncoder,
  type DownloadEvent,
} from "@/lib/localDownload";

/*
 * GET  /api/clip  -> whether local downloads are available on this machine
 * POST /api/clip  { videoId, start, end, name, quality } -> NDJSON DownloadEvents
 *
 * Local-only: see lib/localDownload.ts.
 */

function unavailable(reason: string, status = 403) {
  return Response.json({ enabled: false, reason }, { status });
}

export async function GET(request: Request) {
  if (!isLocalRequest(request) || !localDownloadsEnabled()) {
    return Response.json({ enabled: false, reason: "Downloads only work when the app runs on your computer." });
  }
  const version = await ytDlpVersion();
  if (!version) {
    return Response.json({
      enabled: false,
      reason: "yt-dlp wasn't found. Install it (and ffmpeg), or set YTDLP_PATH in .env.local.",
    });
  }
  return Response.json({ enabled: true, version, folder: clipsDir(), encoder: await videoEncoder() });
}

export async function POST(request: Request) {
  if (!isLocalRequest(request) || !localDownloadsEnabled()) {
    return unavailable("Downloads only work when the app runs on your computer.");
  }
  if (!(await ytDlpVersion())) return unavailable("yt-dlp wasn't found.", 503);

  let body: Partial<ClipSpec>;
  try {
    body = await request.json();
  } catch {
    return unavailable("Invalid request.", 400);
  }
  const spec: ClipSpec = {
    videoId: String(body.videoId ?? ""),
    start: Number(body.start),
    end: Number(body.end),
    name: String(body.name ?? ""),
    quality: (body.quality === "best" ? "best" : "1080") satisfies ClipQuality,
  };
  const invalid = validateClip(spec);
  if (invalid) return unavailable(invalid, 400);

  // Abort when the browser cancels: request.signal does not reliably fire for a
  // disconnect mid-stream, but the response stream gets cancelled.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      abort.abort();
    },
    async start(controller) {
      const send = (e: DownloadEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // client went away
        }
      };
      try {
        await downloadClip(spec, send, abort.signal);
      } catch (e) {
        console.error("[clip]", e);
        send({ type: "error", message: "The download failed unexpectedly." });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
