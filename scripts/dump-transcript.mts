/* Print transcript text at a few points in a video.  npx tsx scripts/dump-transcript.mts <videoId> [points] */
import { getTranscript } from "../lib/transcript";
import { formatTimestamp } from "../lib/timestamp";
const t = await getTranscript(process.argv[2]);
const points = Number(process.argv[3] ?? 8);
console.log(t.video.title, formatTimestamp(t.video.durationSeconds), t.source, t.segments.length, "segments");
for (let k = 0; k < points; k++) {
  const i = Math.floor(((k + 0.5) / points) * t.segments.length);
  console.log(`[${formatTimestamp(t.segments[i].start)}] ${t.segments.slice(i, i + 4).map((s) => s.text).join(" ")}`);
}
