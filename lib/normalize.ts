/*
 * Level 1 matching: text normalization shared by the transcript and queries.
 * Both sides go through exactly the same steps so formatting differences
 * (case, punctuation, curly quotes, hyphens, "$1,000", "one" vs "1") vanish.
 */

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40",
  fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
};

export const STOPWORDS = new Set(
  (
    "a an the and or but so if then than that this these those to of in on at by for with from " +
    "as is am are was were be been being it its i me my we our you your he him his she her they them their " +
    "do does did have has had not no just like um uh oh yeah okay ok well really very also too " +
    "there here what which who whom when where why how all any some can could would should will shall " +
    "may might must about into out up down over again more most such only own same other " +
    "im youre dont its thats theres whats ive id ill were weve theyre gonna wanna kind sort"
  ).split(" "),
);

/** Lowercase, strip accents/punctuation, unify apostrophes/hyphens/numbers. */
export function normalizeText(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[‘’ʼ`´]/g, "'")
      .replace(/(\d),(?=\d{3}\b)/g, "$1") // 1,000 -> 1000
      .replace(/&/g, " and ")
      .replace(/%/g, " percent ")
      .replace(/'/g, "") // don't -> dont
      .replace(/[^a-z0-9]+/g, " ") // hyphens, dashes, punctuation, $
      .trim()
  );
}

/** Light suffix stemmer: enough to align plurals and verb forms. */
export function stem(word: string): string {
  if (/^\d+$/.test(word)) return word;
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);

  if (w.length > 5 && w.endsWith("ing")) w = undouble(w.slice(0, -3));
  else if (w.length > 4 && w.endsWith("ed")) w = undouble(w.slice(0, -2));
  else if (w.length > 5 && w.endsWith("ly")) w = w.slice(0, -2);

  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function undouble(w: string): string {
  return /([^aeioulsz])\1$/.test(w) ? w.slice(0, -1) : w;
}

export interface Token {
  /** Normalized surface form. */
  norm: string;
  /** Stemmed form used for comparison and indexing. */
  stem: string;
  stop: boolean;
}

export function toToken(norm: string): Token {
  const n = NUMBER_WORDS[norm] ?? norm;
  return { norm: n, stem: stem(n), stop: STOPWORDS.has(norm) };
}

export function tokenize(input: string): Token[] {
  const norm = normalizeText(input);
  return norm ? norm.split(" ").map(toToken) : [];
}
