/* Offline checks for the spec's examples and helpers.  npx tsx scripts/test-unit.mts */
import assert from "node:assert/strict";
import { processTranscript, searchTranscript } from "../lib/search";
import { parseSentences, validateSentences } from "../lib/sentences";
import { extractVideoId, buildTimestampUrl } from "../lib/youtube";
import { formatTimestamp, parseTimestamp } from "../lib/timestamp";
import { sanitizeClipName, defaultClipName, ytDlpCommand, validateClip } from "../lib/clip";
import { findMoments } from "../lib/moments/analyze";
import { chaptersFromDescription, parseCount, type Signals } from "../lib/moments/signals";
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

// Full-video downloads: no section cut, no re-encode, no length limit.
const fullCmd = ytDlpCommand({ videoId: "fjox2hapu98", start: 0, end: 0, name: "Whole video", quality: "1080", full: true });
assert.ok(!fullCmd.includes("--download-sections") && !fullCmd.includes("--downloader-args"), fullCmd);
assert.ok(fullCmd.includes("--remux-video mp4") && fullCmd.includes("res:1080"), fullCmd);
assert.equal(validateClip({ videoId: "fjox2hapu98", start: 0, end: 0, name: "x", quality: "1080", full: true }), null);
assert.notEqual(validateClip({ videoId: "bad", start: 0, end: 0, name: "x", quality: "1080", full: true }), null);

// Best Moments helpers
assert.equal(parseCount("1.2K"), 1200);
assert.equal(parseCount("3"), 3);
assert.equal(parseCount(""), 0);
const ch = chaptersFromDescription("Intro text\n0:00 Intro\n4:36 - GPT-4\n1:09:05 Fear\nnot a chapter", 9000);
assert.ok(ch.state === "ok" && ch.value.length === 3 && ch.value[2].start === 4145 && ch.value[1].title === "GPT-4");
assert.equal(chaptersFromDescription("no chapters here", 100).state, "empty");

// Best Moments: neutral talk yields nothing; real cues are found at the right time, per category.
function momentTranscript(extra: [number, string][]): Transcript {
  const cues: [number, string][] = Array.from({ length: 360 }, (_, i) => [i * 5, `we were talking about the market and the weather number ${i} today.`]);
  for (const [t, text] of extra) cues[t / 5] = [t, text];
  const base = fakeTranscript(cues);
  base.video.durationSeconds = 1800;
  base.segments = cues.map(([start, text]) => ({ start, duration: 5, text }));
  return base;
}
const noSignals: Signals = {
  chapters: { state: "empty", reason: "none" },
  heatmap: { state: "unavailable", reason: "test" },
  comments: { state: "unavailable", reason: "test" },
};
const neutral = momentTranscript([]);
for (const type of ["funny", "informative", "emotional", "controversial", "surprising"] as const) {
  assert.equal(findMoments({ transcript: neutral, signals: noSignals, type, count: 10 }).moments.length, 0, type);
}
const rich = momentTranscript([
  [600, "and then he slipped on the stage I was joking but it was hilarious. [Laughter]"],
  [605, "honestly the funniest thing I have ever seen haha. [Laughter]"],
  [1200, "here is my advice the key is to start with one habit."],
  [1205, "the biggest mistake is doing too much for example ten habits at once."],
]);
const funny = findMoments({ transcript: rich, signals: noSignals, type: "funny", count: 10 }).moments;
assert.equal(funny.length, 1);
assert.ok(funny[0].start <= 600 && funny[0].end >= 608 && funny[0].category === "funny", JSON.stringify(funny[0]));
assert.ok(funny[0].signals.includes("Laughter in captions"));
assert.ok(funny[0].excerpt.includes("funniest thing"));
const info = findMoments({ transcript: rich, signals: noSignals, type: "informative", count: 10 }).moments;
assert.equal(info.length, 1);
assert.ok(info[0].start <= 1200 && info[0].end >= 1208, JSON.stringify(info[0]));
const all = findMoments({ transcript: rich, signals: noSignals, type: "all", count: 5 }).moments;
assert.deepEqual(new Set(all.map((m) => m.category)), new Set(["funny", "informative"]));

console.log("all unit checks passed");
