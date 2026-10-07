/** Tunable limits and thresholds. Change here; everything else reads from this file. */
export const LIMITS = {
  maxSentences: 50,
  maxSentenceChars: 500,
  maxInputChars: 25_000,
} as const;

export const MATCHING = {
  /** Minimum score (0–1) for a sentence to count as found. */
  foundThreshold: 0.5,
  /** Scores at or above this are shown as a strong match; below it as "likely". */
  strongThreshold: 0.75,
  /** Minimum score for an alternative match to be shown. */
  alternativeThreshold: 0.5,
  /** Alternatives must be within this much of the best score. */
  alternativeMaxGap: 0.25,
  maxAlternatives: 3,
  /** Matches closer together than this (seconds) are treated as the same moment. */
  dedupeSeconds: 8,
  /** How many candidate regions per sentence get a full alignment. */
  candidatesPerQuery: 12,
} as const;

export const TRANSCRIPT_CACHE = {
  maxEntries: 30,
  ttlMs: 60 * 60 * 1000,
} as const;
