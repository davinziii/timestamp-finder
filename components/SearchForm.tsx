"use client";

import { useMemo, useRef } from "react";
import { parseSentences } from "@/lib/sentences";
import { Button } from "./Button";
import { SentenceInput } from "./SentenceInput";
import { UrlField } from "./UrlField";

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
      <UrlField value={url} onChange={onUrlChange} error={urlError} disabled={busy} />

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
