/*
 * Level 2 matching: fuzzy alignment of a query against a stretch of transcript.
 *
 * Semi-global word alignment (Needleman–Wunsch style, free start and end in the
 * transcript): every query word is either matched to a transcript word (with
 * a fuzzy similarity), or skipped. Transcript words inserted between matches
 * cost a small penalty. Compound transitions let "overtrading" match
 * "over trading" and vice versa. Because alignment runs over words, not cues,
 * a sentence spanning several caption segments is matched naturally.
 */

import type { Token } from "./normalize";

/** Levenshtein distance with an early-exit bound. */
function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 0–1 similarity of two stemmed words. Short words must match exactly. */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const len = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 4) return 0;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const maxEdits = Math.floor(len * 0.25);
  const d = levenshtein(a, b, maxEdits);
  if (d > maxEdits) return 0;
  return 1 - d / len; // e.g. one typo in an 8-letter word -> 0.875
}

export interface QueryToken extends Token {
  weight: number;
}

export interface Alignment {
  /** 0–1 score: matched query weight minus gap penalties, over total weight. */
  score: number;
  /** Index (within the region) of the first and last matched transcript words. */
  first: number;
  last: number;
}

/** Joins two adjacent words for compound matching; "twenty" + "one" -> "21". */
function join(a: Token, b: Token): string {
  if (/^[2-9]0$/.test(a.norm) && /^[1-9]$/.test(b.norm)) return String(Number(a.norm) + Number(b.norm));
  return a.norm + b.stem;
}

const GAP_PENALTY = 0.2; // per extra transcript word between matches (content word)
const STOP_GAP_PENALTY = 0.08; // per extra filler/stop word

export function stopWeight(t: Token) {
  return t.stop ? 0.3 : 1;
}

/**
 * Aligns all of `query` against any sub-span of `region`.
 * Returns null when nothing matched at all.
 */
export function align(query: QueryToken[], region: Token[]): Alignment | null {
  const n = query.length;
  const m = region.length;
  if (!n || !m) return null;
  const totalWeight = query.reduce((s, q) => s + q.weight, 0);

  // Similarity matrix, computed once.
  const sim: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float32Array(m);
    for (let j = 0; j < m; j++) row[j] = wordSimilarity(query[i].stem, region[j].stem);
    sim.push(row);
  }

  // score[i][j]: best score having consumed query[0..i) and ending at region[0..j).
  // first[i][j]: region index of the first matched word on that path (-1 if none yet).
  const W = m + 1;
  const score = new Float32Array((n + 1) * W);
  const first = new Int32Array((n + 1) * W).fill(-1);
  const last = new Int32Array((n + 1) * W).fill(-1);
  const NEG = -1e9;
  for (let i = 1; i <= n; i++) score[i * W] = 0; // query words skipped before any transcript

  for (let i = 1; i <= n; i++) {
    const q = query[i - 1];
    for (let j = 1; j <= m; j++) {
      const idx = i * W + j;
      let best = NEG;
      let bf = -1;
      let bl = -1;

      const consider = (s: number, from: number, matchedAt: number | null) => {
        if (s > best) {
          best = s;
          if (matchedAt === null) {
            bf = first[from];
            bl = last[from];
          } else {
            bf = first[from] === -1 ? matchedAt : first[from];
            bl = matchedAt;
          }
        }
      };

      // Match / substitute query word i-1 with region word j-1.
      const s = sim[i - 1][j - 1];
      const diag = (i - 1) * W + (j - 1);
      if (s > 0) consider(score[diag] + q.weight * s, diag, j - 1);
      else consider(score[diag], diag, null);

      // Skip query word (user added a word that wasn't said).
      const up = (i - 1) * W + j;
      consider(score[up], up, null);

      // Extra transcript word (speaker said more than the user wrote).
      // Before anything is matched this is free: the alignment just starts later.
      const left = i * W + (j - 1);
      const r = region[j - 1];
      const pen = first[left] === -1 ? 0 : r.stop ? STOP_GAP_PENALTY : GAP_PENALTY;
      consider(score[left] - pen, left, null);

      // Compound: one query word = two transcript words ("overtrading" ~ "over trading").
      if (j >= 2) {
        const cs = wordSimilarity(q.stem, join(region[j - 2], region[j - 1]));
        if (cs > 0.8) {
          const from = (i - 1) * W + (j - 2);
          if (score[from] + q.weight * cs > best) {
            best = score[from] + q.weight * cs;
            bf = first[from] === -1 ? j - 2 : first[from];
            bl = j - 1;
          }
        }
      }
      // Compound: two query words = one transcript word.
      if (i >= 2) {
        const p = query[i - 2];
        const cs = wordSimilarity(join(p, q), region[j - 1].stem);
        if (cs > 0.8) {
          const from = (i - 2) * W + (j - 1);
          const gain = (p.weight + q.weight) * cs;
          if (score[from] + gain > best) {
            best = score[from] + gain;
            bf = first[from] === -1 ? j - 1 : first[from];
            bl = j - 1;
          }
        }
      }

      score[idx] = best;
      first[idx] = bf;
      last[idx] = bl;
    }
  }

  // Free end: best cell in the final row.
  let bestJ = -1;
  let bestScore = 0;
  for (let j = 1; j <= m; j++) {
    const idx = n * W + j;
    if (first[idx] !== -1 && score[idx] > bestScore) {
      bestScore = score[idx];
      bestJ = j;
    }
  }
  if (bestJ === -1) return null;
  const idx = n * W + bestJ;
  return {
    score: Math.max(0, Math.min(1, bestScore / totalWeight)),
    first: first[idx],
    last: last[idx],
  };
}
