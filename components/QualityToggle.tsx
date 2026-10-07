"use client";

import type { ClipQuality } from "@/lib/clip";

/** Segmented 1080p / best-resolution switch, used globally and on each clip. */
export function QualityToggle({
  value,
  onChange,
  labels,
  hints,
  small,
}: {
  value: ClipQuality;
  onChange: (q: ClipQuality) => void;
  labels: Record<ClipQuality, string>;
  hints?: Partial<Record<ClipQuality, string>>;
  small?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Clip resolution"
      className="inline-flex rounded-md border border-line bg-surface-2 p-0.5"
    >
      {(["1080", "best"] as ClipQuality[]).map((q) => (
        <button
          key={q}
          type="button"
          role="radio"
          aria-checked={value === q}
          title={hints?.[q]}
          onClick={() => onChange(q)}
          className={`rounded font-medium transition-colors ${small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"} ${
            value === q ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
          }`}
        >
          {labels[q]}
        </button>
      ))}
    </div>
  );
}
