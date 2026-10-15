"use client";

import type { ClipQuality } from "@/lib/clip";
import { Segmented } from "./Segmented";

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
    <Segmented
      label="Clip resolution"
      value={value}
      onChange={onChange}
      small={small}
      options={(["1080", "best"] as ClipQuality[]).map((q) => ({ value: q, label: labels[q], hint: hints?.[q] }))}
    />
  );
}
