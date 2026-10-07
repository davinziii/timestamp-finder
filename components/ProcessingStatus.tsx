import { CheckIcon } from "./Button";

export interface StatusLine {
  stage: string;
  message: string;
}

/** Shows the real stages reported by the server, in order. No fake progress. */
export function ProcessingStatus({ lines, active }: { lines: StatusLine[]; active: boolean }) {
  if (!lines.length) return null;
  return (
    <ol className="space-y-1.5 font-mono text-[13px]" aria-live="polite">
      {lines.map((l, i) => {
        const current = active && i === lines.length - 1;
        return (
          <li key={`${l.stage}-${i}`} className="animate-rise flex items-center gap-2.5">
            {current ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
            ) : (
              <CheckIcon className="size-3.5 text-ok" />
            )}
            <span className={current ? "text-fg" : "text-muted"}>{l.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
