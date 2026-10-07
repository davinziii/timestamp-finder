/* eslint-disable @typescript-eslint/no-explicit-any -- raw YouTube JSON in test scripts */
/*
 * End-to-end accuracy test against real videos.
 * Uses the creator-uploaded captions (punctuated, cleaned) as the "script" and
 * searches for them in the auto-generated transcript, comparing to the true time.
 *   npx tsx scripts/test-pipeline.ts <videoId> [count]
 */
import { getTranscript } from "../lib/transcript";
import { processTranscript, searchTranscript } from "../lib/search";
import { formatTimestamp } from "../lib/timestamp";

const videoId = process.argv[2] ?? "L_Guz73e6fw";
const count = Number(process.argv[3] ?? 20);

async function manualCues(id: string) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en" } }, videoId: id }),
  });
  const j = await r.json();
  const track = (j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).find((t: any) => t.kind !== "asr");
  if (!track) return null;
  const d = await (await fetch(track.baseUrl.replace(/&fmt=[^&]*/, "") + "&fmt=json3")).json();
  return (d.events as any[]).filter((e) => e.segs).map((e) => ({ start: e.tStartMs / 1000, text: e.segs.map((s: any) => s.utf8).join("").replace(/\s+/g, " ").trim() }));
}

const t0 = Date.now();
const transcript = await getTranscript(videoId);
const t1 = Date.now();
const pt = processTranscript(transcript);
const t2 = Date.now();
console.log(`${transcript.video.title} — ${formatTimestamp(transcript.video.durationSeconds)} — ${transcript.source}, ${pt.tokens.length} words`);
console.log(`fetch ${t1 - t0}ms, process ${t2 - t1}ms`);

const cues = await manualCues(videoId);
if (!cues) { console.log("no manual captions for ground truth"); process.exit(0); }

// Pick evenly spaced cue pairs (two cues joined = sentence spanning segments).
const picks: { truth: number; text: string }[] = [];
for (let k = 0; k < count; k++) {
  const i = Math.floor(((k + 0.5) / count) * (cues.length - 2));
  picks.push({ truth: cues[i].start, text: `${cues[i].text} ${cues[i + 1].text}` });
}
const t3 = Date.now();
const results = searchTranscript(picks.map((p) => p.text), pt);
const t4 = Date.now();
let ok = 0;
for (const r of results) {
  const truth = picks[r.index].truth;
  const diff = r.best ? r.best.start - truth : NaN;
  const good = r.found && Math.abs(diff) <= 3;
  if (good) ok++;
  console.log(`${good ? "✓" : "✕"} ${String(r.index + 1).padStart(2)} truth ${formatTimestamp(truth)} got ${r.best ? formatTimestamp(r.best.start) : "-"} (${diff.toFixed(1)}s) ${Math.round((r.best?.score ?? 0) * 100)}% alts=${r.alternatives.length} | ${r.query.slice(0, 70)}`);
}
console.log(`\n${ok}/${results.length} within 3s — search ${t4 - t3}ms for ${results.length} sentences`);
