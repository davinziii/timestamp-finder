import type { ErrorCode } from "@/types/search";

export interface JobError {
  code: ErrorCode;
  message: string;
  detail?: string;
}

const ERROR_TITLES: Partial<Record<ErrorCode, string>> = {
  TRANSCRIPT_UNAVAILABLE: "Transcript unavailable",
  NO_CAPTIONS: "Transcript unavailable",
  VIDEO_UNAVAILABLE: "Video unavailable",
  INVALID_INPUT: "Check your input",
  INTERNAL: "Something went wrong",
};

export function ErrorPanel({ error }: { error: JobError }) {
  const title = ERROR_TITLES[error.code] ?? "Something went wrong";
  return (
    <div role="alert" className="animate-rise rounded-xl border border-bad/30 bg-bad-soft p-4 sm:p-5">
      <p className="font-medium text-bad">{title}.</p>
      <p className="mt-1 text-sm leading-relaxed text-fg/80">{error.message}</p>
      {error.detail && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <p className="mt-1.5 font-mono break-words">{error.detail}</p>
        </details>
      )}
    </div>
  );
}
