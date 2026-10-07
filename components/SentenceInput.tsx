"use client";

import { LIMITS } from "@/lib/config";

const PLACEHOLDER = `Paste the sentences you're looking for.
One sentence per line works best.

Example:
I made my first million dollars when I was 21.
The biggest mistake traders make is overtrading.
Here's exactly how I found that opportunity.`;

export function SentenceInput({
  value,
  onChange,
  count,
  onSubmitShortcut,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
  onSubmitShortcut: () => void;
  disabled?: boolean;
}) {
  const over = count > LIMITS.maxSentences;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor="sentences" className="text-[13px] font-medium">
          Sentences to find
        </label>
        <span className={`font-mono text-xs tabular-nums ${over ? "text-bad" : "text-faint"}`}>
          {count} / {LIMITS.maxSentences}
        </span>
      </div>
      <textarea
        id="sentences"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmitShortcut();
          }
        }}
        placeholder={PLACEHOLDER}
        rows={8}
        spellCheck={false}
        maxLength={LIMITS.maxInputChars}
        className="block min-h-44 w-full resize-y rounded-lg border border-line bg-surface px-3.5 py-3 text-[14px] leading-relaxed shadow-xs outline-none placeholder:text-faint focus:border-line-strong focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60"
      />
      <p className="mt-1.5 text-xs text-faint">
        One line per sentence. Exact wording isn&rsquo;t required. A pasted paragraph is split into
        sentences automatically. <span className="hidden sm:inline">Ctrl/⌘ + Enter to search.</span>
      </p>
    </div>
  );
}
