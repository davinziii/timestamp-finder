/*
 * Best Moments against a real video: prints the picks for every moment type
 * and checks the invariants (supported timestamps, no overlaps, excerpts from
 * the transcript, categories change the picks).
 *   npx tsx scripts/test-moments.mts <videoId> [count]
 */
import assert from "node:assert/strict";
import { findMoments } from "../lib/moments/analyze";
import { getSignals } from "../lib/moments/signals";
import { getTranscript } from "../lib/transcript";
import { formatTimestamp } from "../lib/timestamp";
import { MOMENT_TYPES } from "../types/moments";

const videoId = process.argv[2] ?? "L_Guz73e6fw";
const count = Number(process.argv[3] ?? 10);
const verbose = process.argv.includes("-v");

const t0 = Date.now();
const transcript = await getTranscript(videoId);
const signals = await getSignals(videoId, transcript.description ?? "", transcript.video.durationSeconds);
console.log(`${transcript.video.title} (${formatTimestamp(transcript.video.durationSeconds)}), fetched in ${Date.now() - t0} ms`);
for (const [k, s] of Object.entries(signals)) {
  console.log(`  ${k}: ${s.state}${s.state === "ok" ? ` (${s.value.length})` : ` — ${s.reason}`}`);
}

const spoken = transcript.words.map((w) => w.text).join(" ");
const picks: Record<string, string> = {};
for (const { value, label } of MOMENT_TYPES) {
  const t1 = Date.now();
  const { moments, candidateCount } = findMoments({ transcript, signals, type: value, count });
  console.log(`\n=== ${label}: ${moments.length}/${count} from ${candidateCount} candidates (${Date.now() - t1} ms)`);
  for (const m of moments) {
    console.log(
      `${String(m.rank).padStart(2)}. ${formatTimestamp(m.start)}–${formatTimestamp(m.end)} (${m.end - m.start}s) ${m.category.padEnd(13)} ${m.potential.padEnd(6)} ${m.title}`,
    );
    if (verbose) console.log(`    key: “${m.keyLine.slice(0, 140)}”\n    why: ${m.why}\n    pot: ${m.potentialReason}`);
    assert.ok(m.end > m.start && m.start >= 0, "valid range");
    assert.ok(m.end - m.start <= 155, "range within the category's limit");
    assert.ok(spoken.includes(m.excerpt.split(" ").slice(0, 6).join(" ")), "excerpt comes from the transcript");
  }
  const sorted = [...moments].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end, "no overlapping moments");
  picks[value] = moments.map((m) => m.start).join(",");
}
const distinct = new Set(Object.values(picks).filter(Boolean)).size;
console.log(`\n${distinct} distinct result sets across ${MOMENT_TYPES.length} types`);
assert.ok(distinct >= 4, "moment types should change the picks");
