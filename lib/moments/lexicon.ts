/*
 * Spoken-language cues per moment category, with weights.
 *
 * Phrases are matched against normalized transcript text (lowercase, no
 * punctuation or apostrophes: "that's" -> "thats"), on word boundaries. A cue
 * is evidence, not proof: a moment needs several cues (or a stronger signal
 * such as captioned laughter) before it is suggested at all.
 *
 * This is the piece to swap out for an AI model later: anything that returns
 * per-category scores for a span of transcript can replace scoreText().
 */

export type CueCategory = "funny" | "informative" | "controversial" | "emotional" | "surprising";

type Lexicon = Record<string, number>;

export const CUES: Record<CueCategory, Lexicon> = {
  funny: {
    haha: 1.5, hahaha: 1.5, lol: 1.2, lmao: 1.5, hilarious: 1.5, funniest: 1.5, "so funny": 1.5, "thats funny": 1.5,
    "its funny": 0.6, funny: 0.8, "im dying": 1.2, "im dead": 1, "i was joking": 1.2, "just kidding": 1.2,
    "im kidding": 1.2, "are you kidding": 1, "youre kidding": 1, joke: 0.8, jokes: 0.8, joking: 1, laughing: 1.2,
    "cracking up": 1.5, comedy: 0.8, comedian: 0.6, ridiculous: 0.7, absurd: 0.7, embarrassing: 0.9, awkward: 0.7,
    "what the hell": 0.8, "oh my god": 0.5, prank: 1, roast: 0.8, drunk: 0.6, naked: 0.6, fart: 1, weird: 0.4,
    stupid: 0.4, dumb: 0.4, idiot: 0.5, silly: 0.6, goofy: 0.8, "made fun": 0.8, "make fun": 0.8, "the punchline": 1.2,
  },
  informative: {
    "the key is": 1.5, "the key thing": 1.5, "the most important": 1.3, "the reason why": 1, "the reason is": 1.2,
    "heres how": 1.3, "how to": 0.8, "step one": 1.2, "first step": 1.2, "the first thing": 0.9, "you should": 0.7,
    "you need to": 0.7, "make sure": 0.7, "the trick is": 1.3, tip: 0.9, tips: 0.9, advice: 1, "my advice": 1.3,
    lesson: 1, lessons: 1, "the lesson": 1.2, "biggest mistake": 1.5, mistake: 0.6, mistakes: 0.7,
    "most people dont": 1, "what happens is": 0.9, "the way it works": 1.2, "in other words": 0.9,
    "for example": 0.9, "for instance": 0.9, "which means": 0.7, "that means": 0.6, research: 0.7, study: 0.6,
    studies: 0.8, "studies show": 1.3, data: 0.5, percent: 0.6, statistic: 0.9, statistics: 0.9,
    "the difference between": 1, framework: 0.9, strategy: 0.7, principle: 0.9, "rule of thumb": 1.3,
    "let me explain": 1.2, explain: 0.5, "the problem is": 0.8, "the solution": 1, "the answer is": 1,
    "the best way": 1.1, "if you want to": 0.7, "focus on": 0.7, "start with": 0.6, "the goal is": 0.9,
    "what i learned": 1.3, "i learned": 0.8, "the secret is": 0.8, "the formula": 1, technique: 0.8, habit: 0.6,
    habits: 0.7, "works like this": 1.2,
  },
  controversial: {
    "i disagree": 1.5, "i dont agree": 1.5, disagree: 1, "thats not true": 1.3, "thats wrong": 1.3,
    "youre wrong": 1.5, "unpopular opinion": 2, "hot take": 2, controversial: 1.3, overrated: 1.3,
    "nobody wants to hear": 1.5, "people wont like": 1.3, "gonna get hate": 1.5, "going to get hate": 1.5,
    bullshit: 1, scam: 1.1, scammers: 1, lying: 0.9, liar: 1, lies: 0.8, fraud: 1, corrupt: 1, corruption: 1,
    propaganda: 1, censorship: 1, hypocrite: 1.2, hypocrisy: 1.2, "the problem with": 0.7, "no no no": 1,
    "come on": 0.5, argue: 0.7, argument: 0.6, debate: 0.7, blame: 0.6, "should be banned": 1.3, dangerous: 0.5,
    evil: 0.8, "i dont think so": 1, "i dont buy": 1.3, "absolutely not": 1.2, "thats absurd": 1.2,
    "thats ridiculous": 1.2, criticism: 0.7, critics: 0.7, offended: 1, outrage: 1, "a joke": 0.3,
    "pushback": 0.8, "wrong about": 1, "dead wrong": 1.5, "i hate": 0.6, "hate it": 0.6, "the truth is": 0.6,
  },
  emotional: {
    "i remember": 0.8, "when i was": 0.6, "growing up": 0.9, "my mom": 1, "my mother": 1, "my dad": 1,
    "my father": 1, "my wife": 0.8, "my husband": 0.8, "my son": 0.9, "my daughter": 0.9, "my kids": 0.8,
    "my family": 0.9, "my brother": 0.7, "my sister": 0.7, "passed away": 1.6, died: 1.1, death: 0.8,
    funeral: 1.5, cancer: 1, hospital: 0.8, cried: 1.5, crying: 1.4, tears: 1.4, "broke down": 1.3,
    depressed: 1.3, depression: 1.3, anxiety: 0.9, suicide: 1.5, lonely: 1.2, scared: 0.9, afraid: 0.7,
    "the hardest": 1.2, hardest: 0.9, struggle: 0.8, struggled: 0.9, struggling: 0.9, "lost everything": 1.6,
    homeless: 1.3, "rock bottom": 1.6, proud: 1, grateful: 1.1, thankful: 0.9, "means a lot": 1.2,
    "means everything": 1.3, "changed my life": 1.5, "never forget": 1.2, "gave up": 0.9, "almost quit": 1.3,
    trauma: 1.3, healing: 1, forgive: 1.1, forgiveness: 1.2, regret: 1, "i miss": 1, emotional: 1,
    inspired: 0.8, inspiring: 0.9, heartbroken: 1.6, heartbreaking: 1.5, vulnerable: 1.1, "love you": 0.9,
    "i love him": 1, "i love her": 1, "my heart": 1, "it hurt": 1, "it hurts": 1, divorce: 1, "lost my": 1.2,
  },
  surprising: {
    "turns out": 1.4, "it turns out": 1.5, "believe it or not": 1.6, "you wont believe": 1.4,
    "i couldnt believe": 1.3, "i cant believe": 1, "no idea": 0.8, "had no idea": 1.2, shocked: 1.3,
    shocking: 1.3, surprised: 1, surprising: 1.1, surprisingly: 1.1, unbelievable: 1.2, insane: 0.6,
    crazy: 0.5, wild: 0.5, "the craziest": 1.3, "nobody knows": 1.3, "most people dont know": 1.5, secret: 0.7,
    "plot twist": 1.8, "out of nowhere": 1.2, suddenly: 0.9, "all of a sudden": 1, "the opposite": 0.8,
    counterintuitive: 1.5, strangely: 1, weirdly: 1, "mind blowing": 1.5, "blew my mind": 1.6, "wait what": 1.5,
    "holy shit": 1.2, "never seen": 1, "first time ever": 1.2, "world record": 1.3, impossible: 0.8,
    "by accident": 1, "found out": 0.9, discovered: 0.9, revealed: 1, "the real reason": 1.4,
    "fun fact": 1.5, "little known": 1.4, "no way": 0.7, "jaw dropping": 1.4, unexpected: 1.1, unexpectedly: 1.1,
  },
};

/** Lines that make a strong opening for a standalone clip. */
export const HOOKS: Lexicon = {
  "the biggest": 1, "the most": 0.7, "the best": 0.6, "the worst": 0.8, nobody: 0.7, "no one": 0.6, never: 0.4,
  heres: 0.7, "here is": 0.6, "the truth": 0.9, "the secret": 1, "the reason": 0.7, "you need to": 0.7, stop: 0.6,
  "if you": 0.5, why: 0.4, "what if": 0.9, imagine: 0.9, "i bet": 0.8, "let me tell you": 1, "the one thing": 1,
  "number one": 0.9, "this is how": 1, "this is why": 1, "most people": 0.9, everybody: 0.4, everyone: 0.4,
  "i used to": 0.7, "the first time": 0.6, "true story": 1.2, "real talk": 0.8,
};

/** Sponsor reads and channel housekeeping: never a "best moment". */
export const AD_CUES: Lexicon = {
  sponsor: 1, sponsored: 1.5, "brought to you by": 2, "promo code": 2, "use code": 2, "discount code": 2,
  "link in the description": 1.5, "link below": 1, "links below": 1, subscribe: 0.8, "like and subscribe": 1.5,
  "hit the like": 1.5, patreon: 1.2, merch: 1, "free trial": 1.5, "first month free": 2, "check out": 0.4,
  squarespace: 2, betterhelp: 2, nordvpn: 2, expressvpn: 2, "athletic greens": 2, ag1: 2, audible: 1.5,
  skillshare: 2, manscaped: 2, hellofresh: 2, "raid shadow legends": 2, netsuite: 2, simplisafe: 2,
  shopify: 1.2, "go to": 0.3, "dot com slash": 2, "com slash": 2,
};

/** First words that usually mean the line depends on what came before. */
export const CONTEXT_DEPENDENT_STARTS: Record<string, number> = {
  and: 1, but: 1, because: 1, or: 1, which: 1, also: 0.8, then: 0.6, so: 0.3, it: 0.4, its: 0.4, that: 0.5,
  thats: 0.4, this: 0.3, he: 0.5, she: 0.5, they: 0.5, theyre: 0.5, hes: 0.5, shes: 0.5, yeah: 0.5, yes: 0.5,
  no: 0.3, right: 0.5, exactly: 0.8, uh: 0.4, um: 0.4, mhm: 0.6, too: 0.6, either: 0.8,
};

/** Viewer-comment wording that hints at a category. Matched on lowercased comment text. */
export const COMMENT_HINTS: Record<CueCategory, RegExp> = {
  funny: /😂|🤣|💀|\blo+l\b|\blmf?ao+\b|\bhaha|hilarious|funniest|\bdying\b|i'?m dead|laughed|cracked me up/i,
  emotional: /😭|🥺|❤️|\bcried\b|\bcrying\b|\btears\b|chills|goosebumps|touching|heartbreaking|heartwarming|emotional/i,
  surprising: /\bwtf\b|mind ?blown|\bno way\b|shocked|plot twist|didn'?t expect|unexpected|insane|jaw/i,
  controversial: /disagree|\bwrong\b|\bbs\b|\bcap\b|controversial|hot take|unpopular|debate/i,
  informative: /great advice|\blearned\b|valuable|golden|\bgold\b|insight|so true|lesson|underrated advice/i,
};

/** Words that carry no topic, for keyword titles. */
export const STOPWORDS = new Set(
  (
    "a about above after again against all almost also am an and any are arent as at be because been before being " +
    "below between both but by can cant could couldnt did didnt do does doesnt doing dont down during each even " +
    "ever every few for from further get gets getting go goes going gonna got gotta had hadnt has hasnt have havent " +
    "having he hed hell hes her here heres hers herself him himself his how hows i id ill im ive if in into is isnt " +
    "it its itself just kind know knew let lets like little lot lots make made many may maybe me might more most " +
    "much must my myself need never no nor not now of off oh ok okay on once one only or other ought our ours " +
    "ourselves out over own pretty probably put quite really right said same say saying says see seen shall she " +
    "shed shell shes should shouldnt so some something sort still such sure take talk talking tell than that thats " +
    "the their theirs them themselves then there theres these they theyd theyll theyre theyve thing things think " +
    "thinking this those though thought through to too totally uh um under until up upon us use used very want " +
    "wanted was wasnt way we wed well went were werent weve what whats when whens where wheres whether which while " +
    "who whos whom why whys will with wont would wouldnt yeah yes yet you youd youll your youre yours yourself " +
    "yourselves youve actually basically literally anyway anything everything nothing someone somebody anybody " +
    "everybody everyone guy guys people person stuff mean means meant okay alright exactly definitely absolutely " +
    "obviously sometimes always back look looking come came coming give gave good great bad big lot new old two " +
    "three first last long thats able around year years time times day days today year whatever kinda wanna ones " +
    "able across along already another away else enough far hey hmm huh mhm uhh umm wow oh yep nope true " +
    "better less part parts others bunch find perhaps feel stuff whole kinda sorta least maybe point sense case"
  ).split(" "),
);

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface CueHits {
  score: number;
  phrases: string[];
}

/** Sums the weights of the lexicon phrases found in normalized text (each phrase counts at most twice). */
export function scoreText(normalized: string, lexicon: Lexicon): CueHits {
  const padded = ` ${normalized} `;
  let score = 0;
  const phrases: string[] = [];
  for (const [phrase, weight] of Object.entries(lexicon)) {
    const needle = ` ${phrase} `;
    let idx = padded.indexOf(needle);
    let n = 0;
    while (idx !== -1 && n < 2) {
      n++;
      idx = padded.indexOf(needle, idx + needle.length - 1);
    }
    if (n) {
      score += weight * n;
      phrases.push(phrase);
    }
  }
  return { score, phrases };
}
