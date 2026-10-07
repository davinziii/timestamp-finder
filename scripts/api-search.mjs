// POST to the running dev server and print the streamed events compactly.
// node scripts/api-search.mjs <url> <sentences-file>
import { readFileSync } from "node:fs";
const [url, file] = process.argv.slice(2);
const t0 = Date.now();
const res = await fetch("http://localhost:3100/api/search", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ url, sentences: file ? readFileSync(file, "utf8") : "hello there" }) });
console.log("HTTP", res.status);
const text = await res.text();
for (const line of text.split("\n").filter(Boolean)) {
  const ev = JSON.parse(line);
  if (ev.type === "status") console.log(`[+${Date.now() - t0}ms] ${ev.message}`);
  else if (ev.type === "video") console.log(`VIDEO ${ev.video.title} (${ev.video.durationSeconds}s) ${ev.source}`);
  else if (ev.type === "error") console.log("ERROR", ev.code, "|", ev.message, "|", ev.detail ?? "");
  else if (ev.type === "done") {
    console.log(`FOUND ${ev.summary.found}/${ev.summary.total} in ${ev.elapsedMs}ms`);
    const fmt = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(x).padStart(2, "0"); };
    for (const r of ev.results) console.log(`${r.found ? "✓" : "✕"} ${String(r.index + 1).padStart(2, "0")} ${r.best ? fmt(r.best.start) + " " + Math.round(r.best.score * 100) + "%" : "-"}${r.alternatives.length ? " alts: " + r.alternatives.map((a) => fmt(a.start) + " " + Math.round(a.score * 100) + "%").join(", ") : ""} | ${r.query.slice(0, 60)}${r.best ? "\n      heard: " + r.best.text.slice(0, 100) : ""}`);
  } else console.log(line);
}
