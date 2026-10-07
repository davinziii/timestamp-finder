/* Offline checks for the spec's examples and helpers.  npx tsx scripts/test-unit.mts */
import assert from "node:assert/strict";
import { processTranscript, searchTranscript } from "../lib/search";
import { parseSentences, validateSentences } from "../lib/sentences";
import { extractVideoId, buildTimestampUrl } from "../lib/youtube";
import { formatTimestamp, parseTimestamp } from "../lib/timestamp";
import { sanitizeClipName, defaultClipName, ytDlpCommand, validateClip } from "../lib/clip";
import type { Transcript } from "../types/transcript";

function fakeTranscript(cues: [number, string][]): Transcript {
  const words = cues.flatMap(([start, text], i) => {
    const end = cues[i + 1]?.[0] ?? start + 4;
    const parts = text.split(" ");
    return parts.map((p, k) => ({ text: p, start: start + ((end - start) * k) / parts.length, end: start + ((end - start) * (k + 1)) / parts.length }));
  });
  return { video: { videoId: "x", title: "", author: "", durationSeconds: 0, thumbnailUrl: "", maxHeight: 0 }, source: "youtube-captions", language: "en", wordTimings: false, segments: [], words };
}

const filler = Array.from({ length: 300 }, (_, i) => [i * 5, `so we were just talking about the market and things like that number ${i}`] as [number, string]);
const t = fakeTranscript([
  ...filler.slice(0, 150),
  [762.5, "One of the biggest mistakes that traders tend to make is over-trading."],
  [766.7, "And honestly I think it's because they're bored."],
  [800, "One of the biggest mistakes traders make"],
  [805, "is chasing green candles"],
  [810, "I made my first million dollars when I was twenty one."],
  ...filler.slice(170).map(([s, x]) => [s + 100, x] as [number, string]),
  [2000, "yeah the biggest mistake that traders make is over trading, I'll say it again"],
]);
const pt = processTranscript(t);
const [a, b, c, d] = searchTranscript([
  "The biggest mistake traders make is overtrading.",
  "One of the biggest mistakes traders make is chasing green candles.",
  "I made my first million dollars when I was 21.",
  "My grandmother taught me how to bake bread.",
], pt);
console.log(a.best?.start, a.alternatives.map((m) => [m.start, m.score]), b.best?.start, c.best, d.best?.score);
const aAll = [a.best!, ...a.alternatives].map((m) => m.start);
assert.ok(a.found && aAll.some((s) => s >= 762.5 && s < 764), "paraphrase + over-trading");
assert.ok(aAll.some((s) => s >= 2000 && s < 2002), "repeated phrase found too (best or alternative)");
assert.ok(b.found && Math.abs(b.best!.start - 800) < 1, "match across two segments starts at first");
assert.ok(c.found && Math.abs(c.best!.start - 810) < 1, "twenty one == 21");
assert.ok(!d.found, "decoy not found");

assert.deepEqual(parseSentences("1. \"First line.\"\n- Second line\n\n• Third line"), ["First line.", "Second line", "Third line"]);
assert.deepEqual(parseSentences("I was broke. Then I discovered crypto! That's when everything changed."), ["I was broke.", "Then I discovered crypto!", "That's when everything changed."]);
assert.deepEqual(parseSentences("[12:42] I was broke. Then crypto.\n02:31 Here's what happened next."), ["I was broke. Then crypto.", "Here's what happened next."]);
assert.equal(validateSentences("").ok, false);
assert.equal(validateSentences(Array.from({ length: 51 }, (_, i) => `line ${i}`).join("\n")).ok, false);

for (const [u, id] of [
  ["https://www.youtube.com/watch?v=L_Guz73e6fw", "L_Guz73e6fw"],
  ["https://youtube.com/watch?feature=share&v=L_Guz73e6fw&t=30s", "L_Guz73e6fw"],
  ["youtu.be/L_Guz73e6fw?si=abc", "L_Guz73e6fw"],
  ["https://m.youtube.com/shorts/L_Guz73e6fw", "L_Guz73e6fw"],
  ["https://www.youtube.com/live/L_Guz73e6fw?feature=shared", "L_Guz73e6fw"],
  ["https://www.youtube.com/embed/L_Guz73e6fw", "L_Guz73e6fw"],
  ["https://vimeo.com/123456", null],
  ["https://evil.com/watch?v=L_Guz73e6fw", null],
  ["https://www.youtube.com/watch?v=short", null],
  ["javascript:alert(1)", null],
  ["not a url", null],
] as const) assert.equal(extractVideoId(u), id, u);

assert.equal(buildTimestampUrl("abc", 763.9), "https://www.youtube.com/watch?v=abc&t=763s");
assert.equal(formatTimestamp(763), "12:43");
assert.equal(formatTimestamp(4051), "1:07:31");
assert.equal(formatTimestamp(151), "02:31");
assert.equal(parseTimestamp("1:07:31"), 4051);
assert.equal(parseTimestamp("12:43"), 763);
assert.equal(parseTimestamp("763s"), 763);
assert.equal(parseTimestamp("1h7m31s"), 4051);
assert.equal(parseTimestamp("12:73"), null);
assert.equal(sanitizeClipName("../../etc/passwd"), "etc passwd");
assert.equal(sanitizeClipName("a \"b\" $c `d` %e% !f"), "a b c d e f");
assert.equal(sanitizeClipName("CON"), "clip");
assert.equal(sanitizeClipName("   "), "clip");
assert.equal(defaultClipName(2, "It takes two or three years to put all of these things together."), "03 - It takes two or three years to");
assert.equal(
  ytDlpCommand({ videoId: "fjox2hapu98", start: 3104, end: 3140.2, name: "06 - High feeling", quality: "1080" }),
  'yt-dlp --no-playlist --download-sections "*51:44-52:21" -S res:1080,proto:m3u8,vcodec:h264,acodec:m4a,ext:mp4 --force-keyframes-at-cuts --downloader-args "ffmpeg_o:-c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart" --remux-video mp4 -P "~/Videos/clips" -o "06 - High feeling.%(ext)s" "https://www.youtube.com/watch?v=fjox2hapu98"',
);
assert.ok(ytDlpCommand({ videoId: "fjox2hapu98", start: 1, end: 5, name: "x", quality: "best" }).includes(" -S res,proto:m3u8"));
assert.equal(validateClip({ videoId: "fjox2hapu98", start: 10, end: 5, name: "x", quality: "1080" }) !== null, true);
assert.equal(validateClip({ videoId: "fjox2hapu98", start: 0, end: 16 * 60, name: "x", quality: "1080" }) !== null, true);
console.log("all unit checks passed");
