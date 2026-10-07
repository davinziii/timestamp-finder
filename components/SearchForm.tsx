"use client";

import { useMemo, useRef } from "react";
import { parseSentences } from "@/lib/sentences";
import { Button } from "./Button";
import { SentenceInput } from "./SentenceInput";

export function SearchForm({
  url,
  sentences,
  onUrlChange,
  onSentencesChange,
  onSubmit,
  busy,
  urlError,
}: {
  url: string;
  sentences: string;
  onUrlChange: (v: string) => void;
  onSentencesChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  urlError: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const count = useMemo(() => parseSentences(sentences).length, [sentences]);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-5 rounded-xl border border-line bg-surface p-4 shadow-sm sm:p-5"
      noValidate
    >
      <div>
        <label htmlFor="url" className="mb-1.5 block text-[13px] font-medium">
          YouTube URL
        </label>
        <input
          id="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          disabled={busy}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-invalid={!!urlError}
          aria-describedby={urlError ? "url-error" : undefined}
          className={`block h-11 w-full rounded-lg border bg-surface px-3.5 font-mono text-[13px] shadow-xs outline-none placeholder:font-sans placeholder:text-faint focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60 ${
            urlError ? "border-bad" : "border-line focus:border-line-strong"
          }`}
        />
        {urlError && (
          <p id="url-error" className="mt-1.5 text-xs text-bad">
            {urlError}
          </p>
        )}
      </div>

      <SentenceInput
        value={sentences}
        onChange={onSentencesChange}
        count={count}
        disabled={busy}
        onSubmitShortcut={() => formRef.current?.requestSubmit()}
      />

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full sm:w-auto">
          {busy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
              Searching…
            </>
          ) : (
            "Find timestamps"
          )}
        </Button>
      </div>
    </form>
  );
}
