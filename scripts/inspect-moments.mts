/*
 * Prints each Best Moments pick with the transcript just before and after it,
 * to judge by reading whether clips start and end at natural points.
 *   npx tsx scripts/inspect-moments.mts <videoId> [type=all] [count=6]
 */
import { findMoments } from "../lib/moments/analyze";
import { getSignals } from "../lib/moments/signals";
import { getTranscript } from "../lib/transcript";
import { formatTimestamp } from "../lib/timestamp";
const [id, type = "all", n = "6"] = process.argv.slice(2);
const t = await getTranscript(id);
const s = await getSignals(id, t.description ?? "", t.video.durationSeconds);
const { moments } = findMoments({ transcript: t, signals: s, type: type as never, count: Number(n) });
// A word belongs to the clip when most of it is inside the range.
const text = (a: number, b: number) =>
  t.words.filter((w) => (w.start + Math.min(w.end, w.start + 0.4)) / 2 >= a && (w.start + Math.min(w.end, w.start + 0.4)) / 2 < b).map((w) => w.text).join(" ");
for (const m of moments) {
  console.log(`\n### ${m.rank} ${formatTimestamp(m.start)}–${formatTimestamp(m.end)} (${m.end - m.start}s) ${m.category} — ${m.title}`);
  console.log(`  BEFORE: …${text(m.start - 25, m.start)}`);
  console.log(`  CLIP:   ${text(m.start, m.end)}`);
  console.log(`  AFTER:  ${text(m.end, m.end + 40)}…`);
}
