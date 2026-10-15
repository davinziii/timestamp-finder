"use client";

import { useId } from "react";

/** The YouTube URL input shared by both tools. */
export function UrlField({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  disabled?: boolean;
}) {
  // Next keeps the other tool's page mounted (hidden), so ids must be unique.
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium">
        YouTube URL
      </label>
      <input
        id={id}
        name="url"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=…"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`block h-11 w-full rounded-lg border bg-surface px-3.5 font-mono text-[13px] shadow-xs outline-none placeholder:font-sans placeholder:text-faint focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60 ${
          error ? "border-bad" : "border-line focus:border-line-strong"
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
