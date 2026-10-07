export interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  durationSeconds: number;
  thumbnailUrl: string;
  /** Highest resolution YouTube offers, as the short side (1080, 1440, 2160). 0 if unknown. */
  maxHeight: number;
}

/** A caption cue as delivered by the source (roughly one subtitle line). */
export interface TranscriptSegment {
  start: number; // seconds
  duration: number; // seconds
  text: string;
}

/** A single spoken word with its own timing. Matching runs on these. */
export interface TranscriptWord {
  text: string;
  start: number; // seconds
  end: number; // seconds
}

export type TranscriptSource = "youtube-asr" | "youtube-captions";

export interface Transcript {
  video: VideoInfo;
  source: TranscriptSource;
  language: string;
  /** True when word times come from the source; false when interpolated inside cues. */
  wordTimings: boolean;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
}
