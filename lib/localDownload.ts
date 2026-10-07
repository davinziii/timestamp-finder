import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeClipName, ytDlpArgs, type ClipSpec, type VideoEncoder } from "./clip";

/*
 * Local-only clip downloads. This runs yt-dlp on the machine serving the app,
 * so it is OFF unless the app is running in development (npm run dev) or
 * ENABLE_LOCAL_DOWNLOADS=true is set, and it only answers requests addressed
 * to localhost. It is never enabled on Vercel.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function localDownloadsEnabled(): boolean {
  if (process.env.VERCEL) return false;
  const flag = process.env.ENABLE_LOCAL_DOWNLOADS;
  if (flag === "false") return false;
  return flag === "true" || process.env.NODE_ENV === "development";
}

function hostnameOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The request must be addressed to localhost (blocks LAN access and DNS
 * rebinding) and, if a browser sent it, come from a localhost page (blocks
 * other websites from triggering downloads on your machine).
 */
export function isLocalRequest(request: Request): boolean {
  const host = hostnameOf(request.headers.get("host"));
  if (!host || !LOCAL_HOSTS.has(host)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    const o = hostnameOf(origin);
    if (!o || !LOCAL_HOSTS.has(o)) return false;
  }
  if (request.method === "POST" && !request.headers.get("content-type")?.includes("application/json")) return false;
  return true;
}

export function clipsDir(): string {
  const configured = process.env.CLIPS_DIR?.trim();
  if (configured) return path.resolve(configured.replace(/^~(?=$|[\\/])/, os.homedir()));
  return path.join(os.homedir(), "Videos", "clips");
}

const ytDlpPath = () => process.env.YTDLP_PATH?.trim() || "yt-dlp";

let versionCheck: Promise<string | null> | null = null;

/** yt-dlp's version, or null if it can't be run. Checked once per server. */
const ffmpegPath = () => process.env.FFMPEG_PATH?.trim() || "ffmpeg";

let encoderCheck: Promise<VideoEncoder> | null = null;

/**
 * Uses the NVIDIA hardware encoder when it actually works (much faster for
 * 4K), otherwise x264 on the CPU. Tested with a real one-frame encode, since
 * NVENC can be listed but unusable (e.g. driver too old).
 */
export function videoEncoder(): Promise<VideoEncoder> {
  encoderCheck ??= new Promise((resolve) => {
    try {
      const child = spawn(/*turbopackIgnore: true*/ 
        ffmpegPath(),
        ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=24", "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-"],
        { windowsHide: true, stdio: "ignore" },
      );
      child.on("error", () => resolve("libx264"));
      child.on("close", (code) => resolve(code === 0 ? "h264_nvenc" : "libx264"));
    } catch {
      resolve("libx264");
    }
  });
  return encoderCheck;
}

export function ytDlpVersion(): Promise<string | null> {
  versionCheck ??= new Promise((resolve) => {
    try {
      const child = spawn(/*turbopackIgnore: true*/ ytDlpPath(), ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    } catch {
      resolve(null);
    }
  }).then((v) => {
    if (v === null) versionCheck = null; // let the user install it and retry
    return v as string | null;
  });
  return versionCheck;
}

/** "name.mp4", "name (2).mp4", … — never overwrite an existing clip. */
function uniqueBaseName(dir: string, name: string): string {
  const taken = new Set(readdirSync(dir).map((f) => path.parse(f).name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export type DownloadEvent =
  | { type: "status"; message: string }
  | { type: "progress"; percent: number }
  | { type: "done"; file: string; sizeBytes: number }
  | { type: "error"; message: string };

let active = 0;
const MAX_CONCURRENT = 2;

export async function downloadClip(
  spec: ClipSpec,
  onEvent: (e: DownloadEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  if (active >= MAX_CONCURRENT) {
    onEvent({ type: "error", message: "Two clips are already downloading. Try again when one finishes." });
    return;
  }
  active++;
  const dir = clipsDir();
  try {
    mkdirSync(dir, { recursive: true });
    const base = uniqueBaseName(dir, sanitizeClipName(spec.name));
    const duration = spec.end - spec.start;
    const encoder = await videoEncoder();

    const run = (extra: string[]) =>
      runYtDlp(
        [
          ...ytDlpArgs(spec, encoder),
          ...extra,
          "--newline",
          "--no-colors",
          "--no-part",
          "-P",
          dir,
          "-o",
          `${base}.%(ext)s`,
          "--print",
          "after_move:TF_FILE:%(filepath)s",
          "--no-quiet",
          `https://www.youtube.com/watch?v=${spec.videoId}`,
        ],
        duration,
        onEvent,
        signal,
      );

    onEvent({ type: "status", message: "Finding the best quality stream…" });
    let result = await run([]);

    // YouTube sometimes refuses a stream URL (HTTP 403), usually a direct HTTPS
    // one. Its HLS streams are far more reliable, so retry once with HLS only.
    if (!result.ok && !signal.aborted && result.forbidden) {
      console.warn(`[clip] ${spec.videoId}: HTTP 403 on first attempt, retrying with HLS streams`);
      removePartial(dir, base);
      onEvent({ type: "status", message: "YouTube refused that stream, trying another…" });
      result = await run(["-f", "bv*[protocol^=m3u8]+ba[protocol^=m3u8]/b[protocol^=m3u8]/bv*+ba/b"]);
    }

    if (signal.aborted) {
      setTimeout(() => removePartial(dir, base), 300);
    } else if (result.ok) {
      onEvent({ type: "done", file: result.file, sizeBytes: statSync(result.file).size });
    } else if (result.spawnError) {
      onEvent({ type: "error", message: `Couldn't run yt-dlp (${result.spawnError}). Install it or set YTDLP_PATH.` });
    } else {
      console.warn(`[clip] yt-dlp failed for ${spec.videoId} ${spec.start}-${spec.end}:\n${result.stderrTail.slice(-2500)}`);
      onEvent({ type: "error", message: explainFailure(result) });
    }
  } finally {
    active--;
  }
}

type RunResult =
  | { ok: true; file: string }
  | { ok: false; code: number | null; stderrTail: string; forbidden: boolean; spawnError?: string };

/** Runs yt-dlp once, streaming status/progress events. */
function runYtDlp(
  args: string[],
  duration: number,
  onEvent: (e: DownloadEvent) => void,
  signal: AbortSignal,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let finalPath: string | null = null;
    let lastPercent = -1;
    let stderrTail = "";

    // stdin closed so ffmpeg never waits on keyboard input; detached on POSIX
    // so the whole process group can be killed on cancel.
    const child = spawn(/*turbopackIgnore: true*/ ytDlpPath(), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const onAbort = () => killTree(child.pid);
    signal.addEventListener("abort", onAbort, { once: true });

    const handleLine = (line: string) => {
      if (line.startsWith("TF_FILE:")) {
        finalPath = line.slice("TF_FILE:".length).trim();
        return;
      }
      if (line.includes("Downloading 1 time ranges") || line.startsWith("[download] Destination")) {
        onEvent({ type: "status", message: "Downloading clip…" });
      }
      // ffmpeg reports how much of the clip it has written: time=00:00:12.34
      const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && duration > 0) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const pct = Math.max(0, Math.min(99, Math.floor((t / duration) * 100)));
        if (pct !== lastPercent) {
          lastPercent = pct;
          onEvent({ type: "progress", percent: pct });
        }
      }
      if (/^\[(VideoRemuxer|Merger|FixupM3u8)\]/.test(line)) onEvent({ type: "status", message: "Finishing file…" });
    };

    const pipe = (stream: NodeJS.ReadableStream, isErr: boolean) => {
      let buf = "";
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (isErr) stderrTail = (stderrTail + text).slice(-6000);
        buf += text;
        const parts = buf.split(/[\r\n]+/);
        buf = parts.pop() ?? "";
        parts.forEach(handleLine);
      });
      stream.on("end", () => buf && handleLine(buf));
    };
    pipe(child.stdout, false);
    pipe(child.stderr, true);

    let settled = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(r);
    };
    child.on("error", (e) =>
      finish({
        ok: false,
        code: null,
        stderrTail,
        forbidden: false,
        spawnError: (e as NodeJS.ErrnoException).code ?? e.message,
      }),
    );
    child.on("close", (code) => {
      if (code === 0 && finalPath && existsSync(/*turbopackIgnore: true*/ finalPath)) finish({ ok: true, file: finalPath });
      else finish({ ok: false, code, stderrTail, forbidden: isForbidden(stderrTail) });
    });
  });
}

/*
 * ffmpeg exits with its AVERROR code, which Windows shows as a huge unsigned
 * number: 3436169992 = 0xCCCFCB08 = AVERROR_HTTP_FORBIDDEN (HTTP 403).
 */
const FFMPEG_HTTP_FORBIDDEN = "3436169992";

function isForbidden(stderr: string): boolean {
  return /403 Forbidden|HTTP Error 403/i.test(stderr) || stderr.includes(FFMPEG_HTTP_FORBIDDEN);
}

function explainFailure(r: Extract<RunResult, { ok: false }>): string {
  if (r.forbidden) {
    return "YouTube refused to serve this video's streams (HTTP 403). Try again in a minute; if it keeps happening, update yt-dlp with \"yt-dlp -U\".";
  }
  const errLine = r.stderrTail.split(/\r?\n/).reverse().find((l) => l.startsWith("ERROR"));
  return errLine ? errLine.replace(/^ERROR:\s*/, "") : `yt-dlp exited with code ${r.code}.`;
}

/** Deletes a half-written clip (ffmpeg may still hold it for a moment). */
function removePartial(dir: string, base: string) {
  for (const f of readdirSync(dir)) {
    if (path.parse(f).name !== base) continue;
    try {
      rmSync(path.join(dir, f), { force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
}

/**
 * Stops yt-dlp AND the ffmpeg it spawned. On Windows killing the parent leaves
 * the child running, so kill the whole tree.
 */
function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn(/*turbopackIgnore: true*/ "taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
}

/** Opens the OS file manager with the clip selected. Only for files in the clips folder. */
export function revealFile(file: string): boolean {
  const dir = clipsDir();
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== dir || !existsSync(resolved)) return false;
  const opts = { windowsHide: false, detached: true, stdio: "ignore" as const };
  if (process.platform === "win32") spawn(/*turbopackIgnore: true*/ "explorer.exe", [`/select,${resolved}`], opts).unref();
  else if (process.platform === "darwin") spawn(/*turbopackIgnore: true*/ "open", ["-R", resolved], opts).unref();
  else spawn(/*turbopackIgnore: true*/ "xdg-open", [dir], opts).unref();
  return true;
}
