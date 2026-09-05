// Text normalisation and fuzzy matching helpers shared by the cleanup pass.

export const FILLERS = new Set(["um", "uh", "uhm", "umm", "hmm", "hm", "mm", "mmm", "er", "erm", "ah", "eh", "uhh", "ahh", "mhm"]);

export function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[^a-z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Sørensen–Dice similarity on token bigrams + unigrams (order-aware enough for retakes). */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const uni = diceSets(new Set(a), new Set(b));
  if (a.length < 3 || b.length < 3) return uni;
  const bg = (t: string[]) => new Set(t.slice(0, -1).map((w, i) => w + " " + t[i + 1]));
  const bi = diceSets(bg(a), bg(b));
  return 0.5 * uni + 0.5 * bi;
}

function diceSets(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** Fraction of `a` that appears, in order, at the start of `b` (false-start detection). */
export function prefixOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let matched = 0;
  let j = 0;
  for (let i = 0; i < a.length && j < Math.min(b.length, a.length + 2); i++) {
    // allow one-word slips
    if (a[i] === b[j]) {
      matched++;
      j++;
    } else if (a[i] === b[j + 1]) {
      matched++;
      j += 2;
    } else {
      j++;
    }
  }
  return matched / a.length;
}

export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
