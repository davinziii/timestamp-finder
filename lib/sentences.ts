import { LIMITS } from "./config";

/** Leading list markers, numbering and timestamps people paste from scripts. */
const LINE_PREFIX = /^\s*(?:[-*•>–—]+|\(?\d{1,3}[.)]|\[?\d{1,2}:\d{2}(?::\d{2})?\]?)\s+/;
const WRAPPING_QUOTES = /^["'“”‘’«»]+|["'“”‘’«»]+$/g;

function clean(line: string): string {
  let s = line.trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(LINE_PREFIX, "").replace(WRAPPING_QUOTES, "").trim();
  } while (s !== prev);
  return s;
}

/** Splits a paragraph into sentences at . ! ? followed by a capital/quote. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])["”’]?\s+(?=["“‘]?[A-Z0-9])/)
    .map(clean)
    .filter(Boolean);
}

/**
 * Turns the textarea contents into individual search queries.
 * - Several lines: each line is one query (the recommended format).
 * - A single pasted paragraph: split into sentences.
 */
export function parseSentences(input: string): string[] {
  const lines = input
    .split(/\r?\n/)
    .map(clean)
    .filter((l) => /[\p{L}\p{N}]/u.test(l));
  const queries = lines.length === 1 ? splitSentences(lines[0]) : lines;
  return queries.filter((q) => /[\p{L}\p{N}]/u.test(q));
}

export type SentenceValidation = { ok: true; sentences: string[] } | { ok: false; message: string };

export function validateSentences(input: string): SentenceValidation {
  if (input.length > LIMITS.maxInputChars) {
    return {
      ok: false,
      message: `That's too much text. Keep it under ${LIMITS.maxInputChars.toLocaleString()} characters.`,
    };
  }
  const sentences = parseSentences(input);
  if (!sentences.length) return { ok: false, message: "Paste at least one sentence to search for." };
  if (sentences.length > LIMITS.maxSentences) {
    return {
      ok: false,
      message: `You can search up to ${LIMITS.maxSentences} sentences at once (you pasted ${sentences.length}).`,
    };
  }
  const tooLong = sentences.findIndex((s) => s.length > LIMITS.maxSentenceChars);
  if (tooLong !== -1) {
    return {
      ok: false,
      message: `Sentence ${tooLong + 1} is too long. Keep each sentence under ${LIMITS.maxSentenceChars} characters.`,
    };
  }
  return { ok: true, sentences };
}
