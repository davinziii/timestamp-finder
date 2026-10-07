import type { TranscriptSource, VideoInfo } from "./transcript";

export interface Match {
  /** Seconds (fractional) where the matched speech starts. */
  start: number;
  /** Seconds (fractional) where the matched speech ends. */
  end: number;
  /** 0–1 similarity between the query and the matched transcript span. */
  score: number;
  /** The transcript words that were matched, for display. */
  text: string;
  /** Which matcher produced this (e.g. "fuzzy"; later "semantic"). */
  matcher: string;
}

export interface SentenceResult {
  index: number;
  query: string;
  found: boolean;
  best: Match | null;
  alternatives: Match[];
}

export interface SearchSummary {
  total: number;
  found: number;
}

export type SearchStage = "transcript" | "processing" | "searching" | "ranking";

export type ErrorCode =
  | "INVALID_URL"
  | "INVALID_INPUT"
  | "VIDEO_UNAVAILABLE"
  | "NO_CAPTIONS"
  | "TRANSCRIPT_UNAVAILABLE"
  | "INTERNAL";

/** Newline-delimited JSON events streamed from /api/search. */
export type SearchEvent =
  | { type: "status"; stage: SearchStage; message: string }
  | { type: "video"; video: VideoInfo; source: TranscriptSource; language: string }
  | { type: "done"; results: SentenceResult[]; summary: SearchSummary; elapsedMs: number }
  | { type: "error"; code: ErrorCode; message: string; detail?: string };
