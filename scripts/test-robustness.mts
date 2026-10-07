/* eslint-disable @typescript-eslint/no-explicit-any -- raw YouTube JSON in test scripts */
/*
 * Robustness test: perturbed versions of real lines (should be found near the
 * true time) and decoy sentences that were never said (should NOT be found).
 *   npx tsx scripts/test-robustness.mts <videoId>
 */
import { getTranscript } from "../lib/transcript";
import { processTranscript, searchTranscript } from "../lib/search";
import { formatTimestamp } from "../lib/timestamp";

const videoId = process.argv[2] ?? "L_Guz73e6fw";
const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en" } }, videoId }) });
const j = await r.json();
const track = j.captions.playerCaptionsTracklistRenderer.captionTracks.find((t: any) => t.kind !== "asr");
const d = await (await fetch(track.baseUrl.replace(/&fmt=[^&]*/, "") + "&fmt=json3")).json();
const cues = (d.events as any[]).filter((e) => e.segs).map((e) => ({ start: e.tStartMs / 1000, text: e.segs.map((s: any) => s.utf8).join("").replace(/\s+/g, " ").trim() }));

// Deterministic PRNG so runs are comparable.
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const SYN: Record<string, string> = { big: "huge", think: "believe", really: "truly", important: "crucial", people: "folks", lot: "ton", good: "great", hard: "difficult", start: "begin", maybe: "perhaps", thing: "stuff", talk: "speak" };
function perturb(text: string, kind: string): string {
  let w = text.replace(/^- /, "").split(/\s+/);
  if (kind === "drop") w = w.filter((_, i) => i === 0 || rnd() > 0.2);
  if (kind === "extra") w = w.flatMap((x) => (rnd() < 0.15 ? ["actually", x] : [x]));
  if (kind === "synonym") w = w.map((x) => SYN[x.toLowerCase().replace(/\W/g, "")] ?? (rnd() < 0.12 ? "something" : x));
  if (kind === "plural") w = w.map((x) => (x.length > 4 && rnd() < 0.3 ? (x.endsWith("s") ? x.slice(0, -1) : x + "s") : x));
  if (kind === "typo") w = w.map((x) => (x.length > 5 && rnd() < 0.3 ? x.slice(0, 2) + x[3] + x[2] + x.slice(4) : x));
  if (kind === "mixed") return perturb(perturb(perturb(text, "drop"), "synonym"), "extra");
  return w.join(" ");
}
const kinds = ["drop", "extra", "synonym", "plural", "typo", "mixed"];
const cases: { truth: number | null; text: string; kind: string }[] = [];
for (let k = 0; k < 30; k++) {
  const i = Math.floor(((k + 0.5) / 30) * (cues.length - 2));
  const kind = kinds[k % kinds.length];
  cases.push({ truth: cues[i].start, kind, text: perturb(`${cues[i].text} ${cues[i + 1].text}`, kind) });
}
const decoys = [
  "I made my first million dollars when I was 21.",
  "The biggest mistake traders make is overtrading.",
  "Here's exactly how I found that opportunity.",
  "You don't need a lot of money to get started.",
  "I was completely broke and then I discovered crypto.",
  "My grandmother taught me how to bake bread in Italy.",
  "The quarterback threw three touchdowns in the second half.",
  "We should invest everything into real estate before prices go up.",
  "The best pizza in New York is in Brooklyn.",
  "I lost all of my savings on a bad stock trade.",
];
for (const t of decoys) cases.push({ truth: null, text: t, kind: "decoy" });

const transcript = await getTranscript(videoId);
const pt = processTranscript(transcript);
const results = searchTranscript(cases.map((c) => c.text), pt);
const stats: Record<string, [number, number]> = {};
for (const res of results) {
  const c = cases[res.index];
  const s = (stats[c.kind] ??= [0, 0]); s[1]++;
  const score = Math.round((res.best?.score ?? 0) * 100);
  let good: boolean;
  if (c.truth === null) good = !res.found;
  else good = res.found && Math.abs(res.best!.start - c.truth) <= 3;
  if (good) s[0]++;
  console.log(`${good ? "✓" : "✕"} ${c.kind.padEnd(7)} ${score}% ${c.truth === null ? "decoy  " : formatTimestamp(c.truth)} -> ${res.found ? formatTimestamp(res.best!.start) : "not found"}${!res.found && res.best ? ` (best ${formatTimestamp(res.best.start)})` : ""} | ${c.text.slice(0, 80)}`);
}
console.log("\n" + Object.entries(stats).map(([k, [a, b]]) => `${k} ${a}/${b}`).join("  "));
