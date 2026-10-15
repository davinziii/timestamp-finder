import type { ErrorCode } from "./search";
import type { TranscriptSource, VideoInfo } from "./transcript";

/** What the user asked for. "all" mixes categories; "shorts" ranks for standalone short-form fit. */
export type MomentType = "all" | "funny" | "informative" | "controversial" | "emotional" | "surprising" | "shorts";

/** What a single moment is labelled as. "popular" = picked mainly from viewer signals (replays, comments). */
export type MomentCategory = "funny" | "informative" | "controversial" | "emotional" | "surprising" | "popular";

export const MOMENT_TYPES: { value: MomentType; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "funny", label: "Funny" },
  { value: "informative", label: "Informative" },
  { value: "controversial", label: "Controversial" },
  { value: "emotional", label: "Emotional" },
  { value: "surprising", label: "Surprising" },
  { value: "shorts", label: "Best for Shorts" },
];

export const CATEGORY_LABELS: Record<MomentCategory, string> = {
  funny: "Funny",
  informative: "Informative",
  controversial: "Controversial",
  emotional: "Emotional",
  surprising: "Surprising",
  popular: "Viewer favorite",
};

export const MOMENT_COUNTS = [5, 10, 15, 20] as const;
export type MomentCount = (typeof MOMENT_COUNTS)[number];

export type ClipPotential = "High" | "Medium" | "Low";

export interface Moment {
  rank: number;
  category: MomentCategory;
  /** Seconds. Snapped to transcript word timings. */
  start: number;
  end: number;
  /** Keyword summary of what the section is about. Not a quote. */
  title: string;
  /** The single strongest transcript line in the moment (actual words). */
  keyLine: string;
  /** The transcript words spoken in the moment. */
  excerpt: string;
  /** Why the moment fits the requested type, built from the evidence found. */
  why: string;
  potential: ClipPotential;
  potentialReason: string;
  /** Short evidence tags shown as chips ("Laughter in captions", "Most replayed"…). */
  signals: string[];
  chapter?: string;
  /** Set when the transcript is known to be incomplete or unreliable in this range. */
  transcriptNote?: string;
}

export type SourceState = "used" | "empty" | "unavailable" | "not-analyzed";

export interface SourceStatus {
  state: SourceState;
  detail: string;
}

export interface SourcesReport {
  transcript: SourceStatus;
  metadata: SourceStatus;
  chapters: SourceStatus;
  comments: SourceStatus;
  replay: SourceStatus;
  visual: SourceStatus;
}

export type MomentsStage = "validate" | "transcript" | "supporting" | "candidates" | "ranking" | "preparing";

/** Newline-delimited JSON events streamed from /api/moments. */
export type MomentsEvent =
  | { type: "status"; stage: MomentsStage; message: string }
  | { type: "video"; video: VideoInfo; source: TranscriptSource; language: string }
  | { type: "sources"; sources: SourcesReport }
  | {
      type: "done";
      moments: Moment[];
      requested: number;
      momentType: MomentType;
      notes: string[];
      elapsedMs: number;
    }
  | { type: "error"; code: ErrorCode; message: string; detail?: string };
