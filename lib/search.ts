import { MATCHING } from "./config";
import { align, stopWeight, wordSimilarity, type QueryToken } from "./fuzzyMatch";
import { toToken, tokenize, normalizeText, type Token } from "./normalize";
import type { Transcript, TranscriptWord } from "@/types/transcript";
import type { Match, SentenceResult } from "@/types/search";

/*
 * Search pipeline
 *
 *   transcript ──processTranscript()──▶ ProcessedTranscript  (once per video, cached)
 *   sentences  ──findCandidates()────▶ candidate matches     (per sentence, cheap)
 *              ──rankCandidates()────▶ SentenceResult[]      (dedupe, threshold, order)
 *
 * Matchers are pluggable: today only the fuzzy word-alignment matcher exists.
 * A semantic matcher (embeddings / LLM) can implement `Matcher` later and its
 * candidates are ranked together with the fuzzy ones.
 */

export interface ProcessedTranscript {
  words: TranscriptWord[];
  tokens: Token[];
  /** stem -> positions in `tokens` */
  index: Map<string, number[]>;
}

export interface Matcher {
  name: string;
  find(query: string, transcript: ProcessedTranscript): Match[];
}

export function processTranscript(transcript: Transcript): ProcessedTranscript {
  const words: TranscriptWord[] = [];
  const tokens: Token[] = [];
  for (const w of transcript.words) {
    // A caption word can normalize to several tokens ("over-trading" -> over, trading).
    const norm = normalizeText(w.text);
    if (!norm) continue;
    const parts = norm.split(" ");
    const step = (w.end - w.start) / parts.length;
    parts.forEach((p, k) => {
      tokens.push(toToken(p));
      words.push({ text: k === 0 ? w.text : "", start: w.start + step * k, end: w.start + step * (k + 1) });
    });
  }
  const index = new Map<string, number[]>();
  tokens.forEach((t, i) => {
    const list = index.get(t.stem);
    if (list) list.push(i);
    else index.set(t.stem, [i]);
  });
  return { words, tokens, index };
}

// ---------------------------------------------------------------------------
// Fuzzy matcher

function prepareQuery(query: string, pt: ProcessedTranscript): QueryToken[] {
  const total = pt.tokens.length || 1;
  return tokenize(query).map((t) => {
    // Rare words carry more signal than common ones.
    const df = pt.index.get(t.stem)?.length ?? 0;
    const rarity = df === 0 ? 1 : Math.min(1, 0.6 + 0.4 * (Math.log(total / df) / Math.log(total)));
    return { ...t, weight: stopWeight(t) * (t.stop ? 1 : rarity) };
  });
}

/** Positions where a query word (or a near spelling of it) occurs. */
function lookup(stem: string, pt: ProcessedTranscript): number[] {
  const exact = pt.index.get(stem);
  if (exact) return exact;
  if (stem.length < 4) return [];
  const out: number[] = [];
  for (const [key, positions] of pt.index) {
    if (wordSimilarity(stem, key) >= 0.75) out.push(...positions);
  }
  return out;
}

/**
 * Votes for regions of the transcript where many query words occur close
 * together, in roughly the right order. Returns approximate start positions.
 */
function candidateAnchors(query: QueryToken[], pt: ProcessedTranscript): number[] {
  const n = query.length;
  const content = query.filter((q) => !q.stop);
  const voters = content.length ? content : query;
  const bucketSize = Math.max(4, Math.ceil(n / 2));
  const votes = new Map<number, number>();
  const totalTokens = pt.tokens.length || 1;

  for (const q of voters) {
    const qi = query.indexOf(q);
    const positions = lookup(q.stem, pt);
    if (!positions.length) continue;
    // Very frequent words vote less.
    const w = Math.log(1 + totalTokens / positions.length);
    const buckets = new Set<number>();
    for (const p of positions) {
      const b = Math.floor((p - qi) / bucketSize);
      buckets.add(b);
      buckets.add(b - 1); // overlap so a sentence on a bucket edge isn't split
    }
    for (const b of buckets) votes.set(b, (votes.get(b) ?? 0) + w);
  }

  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MATCHING.candidatesPerQuery)
    .map(([b]) => b * bucketSize);
}

export const fuzzyMatcher: Matcher = {
  name: "fuzzy",
  find(query, pt) {
    const q = prepareQuery(query, pt);
    if (!q.length) return [];
    const n = q.length;
    const matches: Match[] = [];
    const seen = new Set<string>();

    for (const anchor of candidateAnchors(q, pt)) {
      const from = Math.max(0, anchor - Math.ceil(n / 2) - 4);
      const to = Math.min(pt.tokens.length, anchor + Math.ceil(n * 2.2) + 12);
      const a = align(q, pt.tokens.slice(from, to));
      if (!a) continue;
      const first = from + a.first;
      const last = from + a.last;
      const key = `${first}:${last}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        start: pt.words[first].start,
        end: pt.words[last].end,
        score: a.score,
        text: spanText(pt, first, last),
        matcher: "fuzzy",
      });
    }
    return matches;
  },
};

function spanText(pt: ProcessedTranscript, first: number, last: number): string {
  return pt.words
    .slice(first, last + 1)
    .map((w) => w.text)
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Pipeline stages

const DEFAULT_MATCHERS: Matcher[] = [fuzzyMatcher];

export function findCandidates(
  sentences: string[],
  pt: ProcessedTranscript,
  matchers: Matcher[] = DEFAULT_MATCHERS,
): Match[][] {
  return sentences.map((s) => matchers.flatMap((m) => m.find(s, pt)));
}

export function rankCandidates(sentences: string[], candidates: Match[][]): SentenceResult[] {
  return sentences.map((query, index) => {
    const sorted = [...candidates[index]].sort((a, b) => b.score - a.score || a.start - b.start);

    // Collapse matches that point at the same moment.
    const distinct: Match[] = [];
    for (const m of sorted) {
      if (distinct.every((d) => Math.abs(d.start - m.start) > MATCHING.dedupeSeconds)) distinct.push(m);
    }

    const best = distinct[0];
    if (!best || best.score < MATCHING.foundThreshold) {
      return { index, query, found: false, best: best ?? null, alternatives: [] };
    }
    const alternatives = distinct
      .slice(1)
      .filter(
        (m) =>
          m.score >= MATCHING.alternativeThreshold && best.score - m.score <= MATCHING.alternativeMaxGap,
      )
      .slice(0, MATCHING.maxAlternatives);
    return { index, query, found: true, best, alternatives };
  });
}

export function searchTranscript(sentences: string[], pt: ProcessedTranscript): SentenceResult[] {
  return rankCandidates(sentences, findCandidates(sentences, pt));
}
