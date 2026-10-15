"use client";

import type { ReactNode } from "react";

/** A compact segmented radio control (resolution, result count…). */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  small,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; hint?: string }[];
  label: string;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded font-medium whitespace-nowrap transition-colors disabled:opacity-60 ${
            small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
          } ${value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
