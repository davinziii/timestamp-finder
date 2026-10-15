import type { ClipPotential, Moment, MomentCategory, MomentType } from "@/types/moments";
import type { Transcript } from "@/types/transcript";
import { parseTimestamp } from "../timestamp";
import {
  AD_CUES,
  COMMENT_HINTS,
  CONTEXT_DEPENDENT_STARTS,
  CONTINUATION_START,
  CUES,
  DANGLING_END,
  HOOKS,
  HOUSEKEEPING,
  SETUP_OPENERS,
  normalizeText,
  scoreText,
  STOPWORDS,
  type CueCategory,
} from "./lexicon";
import type { Chapter, HeatMarker, Signals, ViewerComment } from "./signals";

/*
 * Best Moments analysis. No AI service: the transcript's own wording, its
 * timing (pauses), captioned reactions ([Laughter]) and viewer signals
 * (most replayed, comments) are combined into per-category scores.
 *
 *   1. words      -> utterance units, split at pauses / sentence ends
 *   2. units      -> candidate windows: every natural start, with the end
 *                    chosen at a pause within the category's length range
 *   3. windows    -> scores per category + viewer + boundary quality
 *   4. rank       -> for the requested type, drop windows without enough
 *                    evidence, then pick greedily without overlaps
 *
 * Every timestamp comes from transcript word timings.
 */

const CATEGORIES: CueCategory[] = ["funny", "informative", "controversial", "emotional", "surprising"];

/** Minimum category evidence before a window can be suggested for that category. */
const MIN_EVIDENCE = 2;
/** Minimum viewer evidence (replays/comments) for a moment picked mainly by viewers. */
const MIN_VIEWER = 1.6;

/** Seconds: [min, ideal, max] clip length per requested type. */
const LENGTHS: Record<MomentType, [number, number, number]> = {
  all: [25, 60, 120],
  funny: [20, 45, 100],
  informative: [30, 75, 150],
  controversial: [25, 60, 120],
  emotional: [30, 75, 150],
  surprising: [20, 45, 100],
  shorts: [15, 40, 60],
};

/** A clip may only start / end where the boundary score is at least this. */
const START_MIN = 0.3;
const END_MIN = 0.45;

/** Setup openers by first word, to split units where a story or question begins even without a pause. */
const OPENERS_BY_FIRST = (() => {
  const m = new Map<string, string[][]>();
  for (const phrase of Object.keys(SETUP_OPENERS)) {
    const words = phrase.split(" ");
    if (words.length < 2) continue; // single words ("listen") are too common to split on
    m.set(words[0], [...(m.get(words[0]) ?? []), words]);
  }
  return m;
})();

/** Whether a setup opener ("can I tell you", "do you think") starts at word k. */
function opensSetup(words: { text: string }[], k: number): boolean {
  const first = normalizeText(words[k].text);
  const candidates = OPENERS_BY_FIRST.get(first);
  if (!candidates) return false;
  return candidates.some((phrase) => phrase.every((p, n) => words[k + n] && normalizeText(words[k + n].text) === p));
}

// ---------------------------------------------------------------------------
// 1. Units

interface Unit {
  start: number;
  end: number;
  text: string;
  tokens: string[];
  pauseBefore: number;
  pauseAfter: number;
  /** When the last word actually stops (auto-captions stretch a word over the pause after it). */
  spokenEnd: number;
  endsSentence: boolean;
  /**
   * How good a cut is just before / just after this unit: the pause, minus
   * penalties for dangling words ("…item of") and continuations ("because…").
   * Roughly 0 = mid-sentence, 1 = clear sentence end.
   */
  boundaryBefore: number;
  boundaryAfter: number;
  /** Opens a story, question or point ("can I tell you", "do you think"). */
  setup: number;
  /** Show housekeeping ("thank you so much", "welcome back"). */
  housekeeping: number;
  cues: Record<CueCategory, number>;
  /** Number of cue phrases per category (evidence count, not weight). */
  cueCount: Record<CueCategory, number>;
  cuePhrases: Record<CueCategory, string[]>;
  hook: number;
  hookPhrases: string[];
  ad: number;
  numbers: number;
  question: boolean;
  turns: number;
  laughter: number;
  applause: number;
}

const LAUGHTER = /\[(?:[^\]]*\b)?(?:laugh\w*|chuckl\w*|giggl\w*)[^\]]*\]|\((?:[^)]*\b)?(?:laugh\w*|chuckl\w*|giggl\w*)[^)]*\)/gi;
const APPLAUSE = /\[(?:[^\]]*\b)?(?:applause|cheer\w*|clap\w*)[^\]]*\]|\((?:[^)]*\b)?(?:applause|cheer\w*|clap\w*)[^)]*\)/gi;
const QUESTION_START = /^(what|why|how|who|when|where|do you|did you|are you|is it|is that|can you|would you|have you|should)\b/;

/**
 * Pause after a word. Auto-captions stretch the word before a pause instead
 * of leaving a gap, so an unusually long word counts as a pause too.
 */
/** A word's end without the pause auto-captions fold into it. */
function spokenEndOf(w: { text: string; start: number; end: number }): number {
  return Math.min(w.end, w.start + Math.min(0.9, 0.12 + 0.07 * w.text.length) + 0.1);
}

function pauseAfterWord(w: { text: string; start: number; end: number }, nextStart: number | undefined): number {
  const gap = nextStart === undefined ? 2 : Math.max(0, nextStart - w.end);
  const expected = Math.min(0.9, 0.12 + 0.07 * w.text.length);
  return gap + Math.max(0, w.end - w.start - expected);
}

/**
 * Scores every cut between units. Captions without punctuation leave the
 * pause as the main signal, so words that can't end or start a sentence
 * veto a cut: "…the luxury item of | comfort" and "…your story | because"
 * are mid-thought however long the pause.
 */
function scoreBoundaries(units: Unit[]) {
  if (!units.length) return;
  units[0].boundaryBefore = 1.2;
  units[units.length - 1].boundaryAfter = 1.2;
  for (let k = 1; k < units.length; k++) {
    const prev = units[k - 1];
    const next = units[k];
    const last = prev.tokens[prev.tokens.length - 1] ?? "";
    const first = next.tokens[0] ?? "";
    const b =
      Math.min(1.2, next.pauseBefore / 0.6) -
      (DANGLING_END[last] ?? 0) -
      (CONTINUATION_START[first] ?? 0) +
      (prev.endsSentence ? 1 : 0) +
      (next.turns > 0 ? 0.5 : 0) +
      // "…thank you so much yo | can I just tell you the funniest thing": a new story starts here.
      (next.setup > 0 && (DANGLING_END[last] ?? 0) < 0.6 ? 0.6 : 0);
    next.boundaryBefore = b;
    prev.boundaryAfter = b;
  }
}

function buildUnits(t: Transcript): Unit[] {
  const words = t.words;
  const reactions = t.segments.flatMap((s) => {
    const laughs = s.text.match(LAUGHTER)?.length ?? 0;
    const claps = s.text.match(APPLAUSE)?.length ?? 0;
    return laughs || claps ? [{ time: s.start, laughs, claps }] : [];
  });

  const units: Unit[] = [];
  let cur: typeof words = [];
  let curPauseBefore = 2;
  let turnsPending = 0;

  const flush = (pauseAfter: number) => {
    if (!cur.length) return;
    const text = cur.map((w) => w.text).join(" ");
    const norm = normalizeText(text);
    const cues = {} as Record<CueCategory, number>;
    const cuePhrases = {} as Record<CueCategory, string[]>;
    const cueCount = {} as Record<CueCategory, number>;
    for (const c of CATEGORIES) {
      const hit = scoreText(norm, CUES[c]);
      cues[c] = hit.score;
      cuePhrases[c] = hit.phrases;
      cueCount[c] = hit.phrases.length;
    }
    const hook = scoreText(norm, HOOKS);
    const tokens = norm.split(" ").filter(Boolean);
    units.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      spokenEnd: spokenEndOf(cur[cur.length - 1]),
      text,
      tokens,
      pauseBefore: curPauseBefore,
      pauseAfter,
      endsSentence: /[.?!]["')\]]?$/.test(cur[cur.length - 1].text),
      boundaryBefore: 0,
      boundaryAfter: 0,
      setup: Math.min(1.5, scoreText(norm, SETUP_OPENERS).score),
      housekeeping: scoreText(norm, HOUSEKEEPING).score,
      cues,
      cuePhrases,
      cueCount,
      hook: hook.score,
      hookPhrases: hook.phrases,
      ad: scoreText(norm, AD_CUES).score,
      numbers: tokens.filter((x) => /^\d/.test(x) || x === "percent" || x === "million" || x === "billion").length,
      question: /\?/.test(text) || QUESTION_START.test(norm),
      turns: turnsPending,
      laughter: 0,
      applause: 0,
    });
    turnsPending = 0;
    cur = [];
    curPauseBefore = pauseAfter;
  };

  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    // ">>" marks a change of speaker in YouTube captions.
    if (/^>>/.test(w.text)) {
      if (cur.length) flush(0.3);
      turnsPending++;
      if (w.text === ">>" || w.text === ">>>") continue;
    }
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const pause = pauseAfterWord(prev, w.start);
      const sentenceEnd = /[.?!]["')\]]?$/.test(prev.text) && cur.length >= 3;
      // Split at every noticeable pause, and where a story or question opens;
      // whether it's a good place to cut is scored afterwards.
      const opener = cur.length >= 3 && opensSetup(words, k);
      if ((pause >= 0.3 && cur.length >= 3) || pause >= 0.55 || sentenceEnd || opener || w.start - cur[0].start >= 10) {
        flush(pause);
      }
    }
    cur.push({ ...w, text: w.text.replace(/^>+/, "") });
  }
  flush(2);

  scoreBoundaries(units);

  // Attach captioned reactions to the unit being spoken when they appear
  // (a laugh follows the punchline, so the unit just before counts).
  let u = 0;
  for (const r of reactions) {
    while (u + 1 < units.length && units[u + 1].start <= r.time) u++;
    if (!units.length) break;
    units[u].laughter += r.laughs;
    units[u].applause += r.claps;
  }
  return units;
}

// ---------------------------------------------------------------------------
// Viewer signals mapped onto the timeline

interface Mention {
  time: number;
  weight: number;
  text: string;
  hints: CueCategory[];
  kind: "timestamp" | "quote";
}

const TS_IN_TEXT = /(?<![\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/g;

function commentMentions(comments: ViewerComment[], units: Unit[], duration: number): Mention[] {
  // 4-gram index over the transcript, to find comments that quote a line.
  const seq: { token: string; time: number }[] = [];
  for (const u of units) {
    const step = (u.end - u.start) / Math.max(1, u.tokens.length);
    u.tokens.forEach((token, i) => seq.push({ token, time: u.start + i * step }));
  }
  const grams = new Map<string, number[]>();
  for (let i = 0; i + 4 <= seq.length; i++) {
    const g = seq.slice(i, i + 4).map((s) => s.token);
    if (g.filter((x) => !STOPWORDS.has(x)).length < 2) continue;
    const key = g.join(" ");
    const list = grams.get(key);
    if (list) list.push(seq[i].time);
    else grams.set(key, [seq[i].time]);
  }

  const out: Mention[] = [];
  for (const c of comments) {
    const weight = 1 + Math.log10(1 + c.likes);
    const hints = CATEGORIES.filter((cat) => COMMENT_HINTS[cat].test(c.text));
    const stamps = [...c.text.matchAll(TS_IN_TEXT)].map((m) => parseTimestamp(m[1])).filter((x) => x !== null);
    // A list of many timestamps is a chapter list, not a reaction to one moment.
    if (stamps.length > 0 && stamps.length <= 3) {
      for (const t of stamps) if (t <= duration) out.push({ time: t, weight, text: c.text, hints, kind: "timestamp" });
      continue;
    }
    if (stamps.length) continue;
    const toks = normalizeText(c.text).split(" ").filter(Boolean);
    const seen: number[] = [];
    for (let i = 0; i + 4 <= toks.length; i++) {
      const times = grams.get(toks.slice(i, i + 4).join(" "));
      if (!times || times.length > 2) continue;
      for (const t of times) {
        if (seen.some((s) => Math.abs(s - t) < 20)) continue;
        seen.push(t);
        out.push({ time: t, weight: weight * 0.7, text: c.text, hints, kind: "quote" });
      }
    }
  }
  return out;
}

interface Replay {
  /** 0–1: how far above the video's typical replay level a range is. */
  level(start: number, end: number): number;
}

function replayOf(markers: HeatMarker[] | null, duration: number): Replay | null {
  if (!markers) return null;
  // Everyone starts at 0:00, so the opening always looks "replayed". Ignore it.
  const introEnd = Math.max(60, duration * 0.03);
  const body = markers.filter((m) => m.start >= introEnd);
  if (body.length < 5) return null;
  const sorted = body.map((m) => m.intensity).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const peak = sorted[sorted.length - 1];
  if (peak - median < 0.05) return null;
  return {
    level(start, end) {
      let sum = 0;
      let weight = 0;
      let max = 0;
      for (const m of body) {
        const overlap = Math.min(end, m.start + m.duration) - Math.max(start, m.start);
        if (overlap <= 0) continue;
        sum += m.intensity * overlap;
        weight += overlap;
        max = Math.max(max, m.intensity);
      }
      if (!weight) return 0;
      const v = 0.5 * (sum / weight) + 0.5 * max;
      return Math.max(0, Math.min(1, (v - median) / (peak - median)));
    },
  };
}

// ---------------------------------------------------------------------------
// 2–3. Windows and scores

interface Window {
  i: number;
  j: number;
  start: number;
  end: number;
  cat: Record<CueCategory, number>;
  viewer: number;
  replay: number;
  mentions: Mention[];
  hook: number;
  startQuality: number;
  endQuality: number;
  contextPenalty: number;
  crossesChapter: boolean;
  chapter?: string;
  total: number;
  category: MomentCategory;
  strength: number;
  /** Distinct pieces of evidence for the category (cue phrases, laughter, comment reactions). Set once picked. */
  distinct: number;
}

interface Context {
  units: Unit[];
  type: MomentType;
  replay: Replay | null;
  /** Sorted by time. */
  mentions: Mention[];
  chapters: Chapter[];
  titleTokens: Set<string>;
  duration: number;
  totals: Totals;
}

type Summed = "ad" | "laughter" | "turns" | "numbers" | "applause" | CueCategory | `n:${CueCategory}`;

/** Running totals over units, so any window's sum is one subtraction. */
interface Totals {
  sum(key: Summed, i: number, j: number): number;
}

function runningTotals(units: Unit[]): Totals {
  const keys: Summed[] = [
    "ad", "laughter", "turns", "numbers", "applause", ...CATEGORIES, ...CATEGORIES.map((c) => `n:${c}` as const),
  ];
  const value = (u: Unit, k: Summed): number => {
    if (k === "ad" || k === "laughter" || k === "turns" || k === "numbers" || k === "applause") return u[k];
    if (k.startsWith("n:")) return u.cueCount[k.slice(2) as CueCategory];
    return u.cues[k as CueCategory];
  };
  const table = new Map<Summed, Float64Array>();
  for (const k of keys) {
    const t = new Float64Array(units.length + 1);
    units.forEach((u, idx) => (t[idx + 1] = t[idx] + value(u, k)));
    table.set(k, t);
  }
  return { sum: (k, i, j) => table.get(k)![j + 1] - table.get(k)![i] };
}

/** Mentions with time in [from, to]; `sorted` is ordered by time. */
function mentionsBetween(sorted: Mention[], from: number, to: number): Mention[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].time < from) lo = mid + 1;
    else hi = mid;
  }
  const out: Mention[] = [];
  for (let k = lo; k < sorted.length && sorted[k].time <= to; k++) out.push(sorted[k]);
  return out;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function contextPenaltyOf(u: Unit): number {
  const first = u.tokens[0] ?? "";
  return CONTEXT_DEPENDENT_STARTS[first] ?? 0;
}

function chapterAt(chapters: Chapter[], t: number): Chapter | undefined {
  let found: Chapter | undefined;
  for (const c of chapters) if (c.start <= t) found = c;
  return found;
}

const AD_CHAPTER = /sponsor|\bads?\b|advert|promo|merch|patreon/i;

function scoreWindow(ctx: Context, i: number, j: number): Window | null {
  const { units, type } = ctx;
  const [, ideal] = LENGTHS[type];
  const start = units[i].start;
  const end = units[j].end;
  const dur = end - start;
  const sum = (k: Summed) => ctx.totals.sum(k, i, j);

  if (sum("ad") >= 2) return null;

  const chapter = chapterAt(ctx.chapters, start + 3);
  if (chapter && AD_CHAPTER.test(chapter.title)) return null;
  const crossesChapter = ctx.chapters.some((c) => c.start > start + 8 && c.start < end - 8);

  // Long windows collect more cues by size alone; damp that.
  const lenNorm = Math.sqrt(Math.max(dur, 20) / ideal);
  const laughter = Math.min(3, sum("laughter"));
  const turns = Math.min(4, sum("turns"));
  const numbers = sum("numbers");
  const mentions = mentionsBetween(ctx.mentions, start - 3, end + 3);
  // A top comment reacting to this exact moment ("12:40 😂") is real evidence for a category.
  const hint = (c: CueCategory) => Math.min(2.4, mentions.filter((m) => m.hints.includes(c)).length * 1.2);
  const titleHits = new Set<string>();
  if (ctx.titleTokens.size) {
    for (let k = i; k <= j; k++) for (const t of units[k].tokens) if (ctx.titleTokens.has(t)) titleHits.add(t);
  }
  const titleOverlap = titleHits.size;

  const cat = {} as Record<CueCategory, number>;
  for (const c of CATEGORIES) cat[c] = sum(c) / lenNorm + hint(c);
  cat.funny += 2.2 * laughter + (cat.funny > 0 ? 0.2 * turns : 0);
  cat.informative += 0.15 * Math.min(6, numbers) + 0.3 * Math.min(3, titleOverlap);
  cat.controversial += cat.controversial > 0 ? 0.15 * turns : 0;
  cat.surprising += 0.1 * Math.min(5, numbers);
  const applause = sum("applause");
  cat.emotional += 0.8 * Math.min(2, applause);

  const replay = ctx.replay?.level(start, end) ?? 0;
  const commentWeight = mentions.reduce((n, m) => n + m.weight, 0);
  const viewer = 1.6 * replay + Math.min(2, 0.7 * commentWeight);

  const startQuality = clamp01(units[i].boundaryBefore);
  const endQuality = clamp01(units[j].boundaryAfter);
  const contextPenalty = contextPenaltyOf(units[i]);
  // Starting on the question or story opener keeps the setup in the clip;
  // starting on "thanks for having me" doesn't. Ending on a question cuts the answer.
  let setup = 0;
  let housekeeping = 0;
  for (let k = i; k <= j && units[k].start < start + 15; k++) {
    if (units[k].start < start + 8) setup += units[k].setup;
    housekeeping += units[k].housekeeping;
  }
  setup = Math.min(1.2, setup);
  housekeeping = Math.min(1.5, housekeeping);
  const endsOnQuestion = units[j].question && units[j].end - units[j].start < 6;
  const lengthFit = 1 - Math.min(1, Math.abs(dur - ideal) / ideal);
  // Hook: the first ~10 seconds.
  let openingHook = 0;
  for (let k = i; k <= j && units[k].start < start + 10; k++) openingHook += units[k].hook;
  const hook = Math.min(2, openingHook) + (units[i].question ? 0.5 : 0);

  const boundary =
    0.6 * startQuality + 0.5 * endQuality + 0.5 * setup - 0.8 * housekeeping - 0.6 * contextPenalty -
    (endsOnQuestion ? 0.5 : 0) - (crossesChapter ? 0.5 : 0) + 0.3 * lengthFit;
  // Separate pieces of evidence (cue phrases, laughter, comment reactions), so one repeated word isn't enough.
  const evidence = (c: CueCategory) =>
    sum(`n:${c}`) + (c === "funny" ? laughter : 0) + mentions.filter((m) => m.hints.includes(c)).length;

  let best: CueCategory = "informative";
  for (const c of CATEGORIES) if (cat[c] > cat[best]) best = c;

  let total: number;
  let category: MomentCategory;
  let strength: number;
  if (type === "shorts") {
    const content = Math.max(cat[best], viewer);
    if (content < 1.5) return null;
    category = cat[best] >= MIN_EVIDENCE && evidence(best) >= 2 ? best : viewer >= MIN_VIEWER ? "popular" : best;
    strength = content;
    total =
      0.6 * cat[best] + 1.2 * hook + 1.2 * startQuality + 0.8 * endQuality + 0.5 * setup - 0.8 * housekeeping -
      1.5 * contextPenalty - (endsOnQuestion ? 0.5 : 0) + 0.6 * viewer + 0.8 * lengthFit - (crossesChapter ? 0.5 : 0);
  } else if (type === "all") {
    if (cat[best] >= MIN_EVIDENCE && evidence(best) >= 2) {
      category = best;
      strength = cat[best];
    } else if (viewer >= MIN_VIEWER) {
      category = "popular";
      strength = viewer;
    } else return null;
    total = strength + 0.6 * viewer + boundary;
  } else {
    if (cat[type] < MIN_EVIDENCE || evidence(type) < 2) return null;
    category = type;
    strength = cat[type];
    total = strength + 0.5 * viewer + boundary;
  }

  return {
    i, j, start, end, cat, viewer, replay, mentions, hook, startQuality, endQuality, contextPenalty,
    crossesChapter, chapter: chapter?.title, total, category, strength, distinct: 0,
  };
}

/** For each natural start, the best-scoring end within the length range. */
function candidateWindows(ctx: Context): Window[] {
  const { units, type } = ctx;
  const [minLen, , maxLen] = LENGTHS[type];
  const out: Window[] = [];
  for (let i = 0; i < units.length; i++) {
    // Only start where a thought plausibly starts.
    if (units[i].boundaryBefore < START_MIN) continue;
    let best: Window | null = null;
    for (let j = i; j < units.length; j++) {
      const dur = units[j].end - units[i].start;
      if (dur > maxLen) break;
      if (dur < minLen) continue;
      // Only end at a pause or sentence end (a complete thought).
      if (units[j].boundaryAfter < END_MIN) continue;
      const w = scoreWindow(ctx, i, j);
      if (w && (!best || w.total > best.total)) best = w;
    }
    if (best) out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Selection

/** Greedy pick without overlaps; "all" spreads picks across categories. */
function select(windows: Window[], count: number, type: MomentType): Window[] {
  const pool = [...windows].sort((a, b) => b.total - a.total).slice(0, 600);
  const chosen: Window[] = [];
  const perCategory = new Map<MomentCategory, number>();
  const overlaps = (a: Window, b: Window) => a.start < b.end + 5 && b.start < a.end + 5;
  while (chosen.length < count) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < pool.length; k++) {
      const w = pool[k];
      if (chosen.some((c) => overlaps(c, w))) continue;
      const repeat = type === "all" ? (perCategory.get(w.category) ?? 0) : 0;
      const eff = w.total * Math.pow(0.85, repeat);
      if (eff > bestScore) {
        bestScore = eff;
        bestIdx = k;
      }
    }
    if (bestIdx === -1) break;
    const w = pool.splice(bestIdx, 1)[0];
    chosen.push(w);
    perCategory.set(w.category, (perCategory.get(w.category) ?? 0) + 1);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Presentation: title, key line, explanation, potential

/** Opening-hook score from which a Short counts as having a hook (a question alone qualifies). */
const HOOK_MIN = 0.5;

const CATEGORY_LEADS: Record<CueCategory, string> = {
  funny: "Humor cues",
  informative: "Explanation and advice language",
  controversial: "Disagreement or provocative language",
  emotional: "Personal or emotional language",
  surprising: "Reveal or surprise language",
};

const CONTRACTIONS: Record<string, string> = {
  thats: "that's", im: "I'm", dont: "don't", youre: "you're", cant: "can't", couldnt: "couldn't", wont: "won't",
  heres: "here's", ive: "I've", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", i: "I",
};
const pretty = (phrase: string) => phrase.split(" ").map((w) => CONTRACTIONS[w] ?? w).join(" ");
const quoteList = (phrases: string[], n = 3) => phrases.slice(0, n).map((p) => `“${pretty(p)}”`).join(", ");

const stemOf = (t: string) => t.replace(/(ies|es|s)$/, "");
/** Topic-bearing word: not a stopword, number, or (usually) a verb/adverb form. */
const isTopicWord = (t: string) => t.length >= 4 && !STOPWORDS.has(t) && !/^\d/.test(t) && !/(ed|ing|ly)$/.test(t);

/**
 * Up to three topic phrases for the span, by tf-idf against the whole video.
 * Repeated two-word phrases ("basic income") beat single words.
 */
function keywords(span: Unit[], idf: Map<string, number>): string[] {
  const counts = new Map<string, { n: number; score: number; forms: Map<string, number> }>();
  const add = (key: string, form: string, score: number) => {
    const e = counts.get(key) ?? { n: 0, score, forms: new Map() };
    e.n++;
    e.forms.set(form, (e.forms.get(form) ?? 0) + 1);
    counts.set(key, e);
  };
  for (const u of span) {
    u.tokens.forEach((t, k) => {
      if (!isTopicWord(t)) return;
      add(stemOf(t), t, idf.get(stemOf(t)) ?? 1);
      const next = u.tokens[k + 1];
      if (next && isTopicWord(next) && next !== t) {
        add(`${stemOf(t)} ${stemOf(next)}`, `${t} ${next}`, 1.6 * ((idf.get(stemOf(t)) ?? 1) + (idf.get(stemOf(next)) ?? 1)) / 2);
      }
    });
  }
  const ranked = [...counts.entries()]
    .filter(([, e]) => e.n >= 2)
    .map(([key, e]) => ({
      key,
      phrase: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0][0],
      score: e.n * e.score,
    }))
    .sort((a, b) => b.score - a.score);
  const out: { key: string; phrase: string }[] = [];
  for (const r of ranked) {
    // Skip words already covered by a chosen phrase.
    if (out.some((o) => o.key.split(" ").some((w) => r.key.split(" ").includes(w)))) continue;
    out.push(r);
    if (out.length === 3) break;
  }
  return out.map((o) => o.phrase);
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function titleFor(w: Window, span: Unit[], idf: Map<string, number>): string {
  const kw = keywords(span, idf);
  const topic = kw.length ? joinWords(kw) : "";
  const chapter = w.chapter && !/^(intro|introduction)$/i.test(w.chapter) ? w.chapter : "";
  if (chapter && topic) return `${chapter}: ${topic}`;
  if (chapter) return chapter;
  if (topic) return topic.charAt(0).toUpperCase() + topic.slice(1);
  return "Untitled moment";
}

function keyLineFor(w: Window, span: Unit[], type: MomentType): string {
  const c: CueCategory | null = w.category === "popular" ? null : (w.category as CueCategory);
  const score = (u: Unit, idx: number) => {
    if (type === "shorts" && idx === 0) return u.hook + 1;
    if (c === "funny" && (span[idx + 1]?.laughter || u.laughter)) return 5 + u.cues.funny;
    return c ? u.cues[c] : 0;
  };
  let best = 0;
  span.forEach((u, idx) => {
    if (score(u, idx) > score(span[best], best)) best = idx;
  });
  let line = span[best].text;
  // Very short units read better with the next one.
  if (line.split(" ").length < 6 && span[best + 1]) line += " " + span[best + 1].text;
  return tidy(line);
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function snippet(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function explain(w: Window, span: Unit[], type: MomentType): { why: string; signals: string[] } {
  const sentences: string[] = [];
  const signals: string[] = [];
  const laughter = span.reduce((n, u) => n + u.laughter, 0);

  if (w.category === "popular") {
    sentences.push("Picked mainly from viewer behavior rather than the wording alone.");
  } else {
    const c = w.category as CueCategory;
    if (c === "funny" && laughter) {
      sentences.push(`The captions mark laughter ${laughter === 1 ? "once" : `${laughter} times`} in this section.`);
      signals.push("Laughter in captions");
    }
    const phrases = [...new Set(span.flatMap((u) => u.cuePhrases[c]))];
    if (phrases.length) sentences.push(`${CATEGORY_LEADS[c]}: ${quoteList(phrases)}.`);
  }

  if (w.replay >= 0.35) {
    sentences.push(
      w.replay >= 0.75
        ? "Overlaps one of the most-replayed parts of the video."
        : "Viewers replay this part more than most of the video.",
    );
    signals.push("Most replayed");
  }
  if (w.mentions.length) {
    const n = new Set(w.mentions.map((m) => m.text)).size;
    const top = [...w.mentions].sort((a, b) => b.weight - a.weight)[0];
    sentences.push(
      `${n} top comment${n === 1 ? "" : "s"} ${top.kind === "timestamp" ? "point" : "quote or point"}${n === 1 ? "s" : ""} to this moment (e.g. “${snippet(top.text, 70)}”).`,
    );
    signals.push(`${n} comment${n === 1 ? "" : "s"}`);
  }

  if (type === "shorts") {
    const hookPhrases = [...new Set(span.filter((u) => u.start < w.start + 10).flatMap((u) => u.hookPhrases))];
    if (w.hook < HOOK_MIN) {
      // No hook worth mentioning.
    } else if (span[0].question) {
      sentences.push("Opens with a question, which gives a Short an immediate hook.");
      signals.push("Question hook");
    } else if (hookPhrases.length) {
      sentences.push(`Opens with a hook (${quoteList(hookPhrases, 2)}).`);
      signals.push("Strong opening");
    }
  }

  if (w.startQuality >= 0.6 && w.contextPenalty < 0.5 && w.endQuality >= 0.6) {
    sentences.push("Starts after a natural pause and ends at a complete thought, so it stands on its own.");
    signals.push("Self-contained");
  } else if (w.contextPenalty >= 0.5) {
    sentences.push("It begins mid-conversation, so a few seconds of earlier context may help.");
  }
  if (w.crossesChapter) sentences.push("It runs across a chapter change.");

  return { why: sentences.join(" "), signals };
}

function distinctEvidence(w: Window, span: Unit[]): number {
  if (w.category === "popular") return w.mentions.length + (w.replay >= 0.35 ? 1 : 0);
  const c = w.category as CueCategory;
  const laughter = Math.min(3, span.reduce((n, u) => n + u.laughter, 0));
  return (
    new Set(span.flatMap((u) => u.cuePhrases[c])).size +
    (c === "funny" ? laughter : 0) +
    w.mentions.filter((m) => m.hints.includes(c)).length
  );
}

function potentialOf(w: Window, type: MomentType): { potential: ClipPotential; reason: string } {
  const dur = w.end - w.start;
  const selfContained = w.contextPenalty < 0.5 && w.startQuality >= 0.4 && w.endQuality >= 0.4;
  const strong = (w.strength >= 4 && w.distinct >= 3) || (w.strength >= 3 && w.distinct >= 2 && w.viewer >= 1);
  const plus: string[] = [];
  const minus: string[] = [];
  if (strong) plus.push("strong evidence for the category");
  else if (w.strength < 2.6) minus.push("only a few supporting cues");
  if (w.viewer >= 1) plus.push("viewer signals agree");
  if (selfContained) plus.push("clean start and end");
  else minus.push("may need extra context or trimming");
  if (type === "shorts") {
    if (w.hook >= HOOK_MIN) plus.push("a hook in the first seconds");
    else minus.push("no clear opening hook");
    if (dur > 60) minus.push("longer than a Short");
  }
  if (w.crossesChapter) minus.push("crosses a topic change");

  let potential: ClipPotential = "Medium";
  if (strong && selfContained && minus.length === 0) potential = "High";
  else if (minus.length >= 2 || (w.strength < 2.6 && w.viewer < 1)) potential = "Low";

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const reason = [plus.length ? cap(joinWords(plus)) + "." : "", minus.length ? cap(joinWords(minus)) + "." : ""]
    .filter(Boolean)
    .join(" ");
  return { potential, reason: `${reason} An editorial estimate, not a prediction of views.` };
}

function transcriptNoteFor(span: Unit[]): string | undefined {
  let maxGap = 0;
  for (let k = 1; k < span.length; k++) maxGap = Math.max(maxGap, span[k].start - span[k - 1].end);
  if (maxGap >= 12) {
    return `The transcript has no words for about ${Math.round(maxGap)}s here (music, crosstalk or unclear audio). Check the video before clipping.`;
  }
  return undefined;
}

/**
 * Clip times are whole seconds (YouTube links and the clip editor use them).
 * Rounding naively pulls the neighbouring sentence's words into the clip, so
 * pick the whole second that sits in the silence between sentences when there
 * is one, and otherwise clip a fraction of our own word rather than include
 * someone else's.
 */
function snapToSeconds(units: Unit[], i: number, j: number, duration: number): { start: number; end: number } {
  const first = units[i].start;
  const prevEnd = i > 0 ? units[i - 1].spokenEnd : 0;
  let start = Math.floor(first);
  if (start < prevEnd - 0.1) {
    const after = Math.ceil(prevEnd);
    start = after <= first + 0.3 ? after : Math.floor(first);
  }

  const last = units[j].spokenEnd;
  const nextStart = j + 1 < units.length ? units[j + 1].start : Infinity;
  let end = Math.ceil(last + 0.2);
  if (end > nextStart + 0.1) {
    const before = Math.floor(nextStart);
    end = before >= last - 0.3 ? before : Math.ceil(last);
  }
  if (duration > 0) end = Math.min(end, Math.ceil(duration));
  return { start: Math.max(0, start), end: Math.max(end, start + 1) };
}

// ---------------------------------------------------------------------------
// Public API

export interface AnalysisInput {
  transcript: Transcript;
  signals: Signals;
  type: MomentType;
  count: number;
}

export interface AnalysisResult {
  moments: Moment[];
  candidateCount: number;
}

/** Runs the analysis; onStage is called as each real step starts, for progress reporting. */
export function findMoments(
  { transcript, signals, type, count }: AnalysisInput,
  onStage: (stage: "candidates" | "ranking", candidates?: number) => void = () => {},
): AnalysisResult {
  onStage("candidates");
  const units = buildUnits(transcript);
  const duration = transcript.video.durationSeconds || (units.length ? units[units.length - 1].end : 0);
  const ctx: Context = {
    units,
    type,
    replay: replayOf(signals.heatmap.state === "ok" ? signals.heatmap.value : null, duration),
    mentions: (signals.comments.state === "ok" ? commentMentions(signals.comments.value, units, duration) : []).sort(
      (a, b) => a.time - b.time,
    ),
    chapters: signals.chapters.state === "ok" ? signals.chapters.value : [],
    titleTokens: new Set(
      normalizeText(transcript.video.title)
        .split(" ")
        .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
    ),
    duration,
    totals: runningTotals(units),
  };

  const windows = candidateWindows(ctx);
  onStage("ranking", windows.length);
  const chosen = select(windows, count, type);

  // Inverse document frequency over units, for keyword titles.
  const df = new Map<string, number>();
  for (const u of units) {
    for (const t of new Set(u.tokens.map(stemOf))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map([...df].map(([t, n]) => [t, Math.log((units.length + 1) / (n + 0.5))]));

  const moments = chosen.map((w, k): Moment => {
    const span = units.slice(w.i, w.j + 1);
    w.distinct = distinctEvidence(w, span);
    const { why, signals: tags } = explain(w, span, type);
    const { potential, reason } = potentialOf(w, type);
    return {
      rank: k + 1,
      category: w.category,
      ...snapToSeconds(units, w.i, w.j, duration),
      title: titleFor(w, span, idf),
      keyLine: keyLineFor(w, span, type),
      excerpt: tidy(span.map((u) => u.text).join(" ")),
      why,
      potential,
      potentialReason: reason,
      signals: tags,
      chapter: w.chapter,
      transcriptNote: transcriptNoteFor(span),
    };
  });

  return { moments, candidateCount: windows.length };
}
