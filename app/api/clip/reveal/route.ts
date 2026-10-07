import { isLocalRequest, localDownloadsEnabled, revealFile } from "@/lib/localDownload";

/** POST /api/clip/reveal { file } -> opens the clips folder with the file selected. Local-only. */
export async function POST(request: Request) {
  if (!isLocalRequest(request) || !localDownloadsEnabled()) {
    return Response.json({ ok: false }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { file?: unknown };
  const ok = typeof body.file === "string" && revealFile(body.file);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
