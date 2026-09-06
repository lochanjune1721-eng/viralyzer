import type { CaptionWordProp } from "../props";

export interface CaptionGroup {
  words: CaptionWordProp[];
  start: number;
  end: number;
}

/** Same grouping rule as the server ASS generator: ~4 words, never across a long pause. */
export function groupWords(words: CaptionWordProp[], maxWords = 4, maxChars = 22): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let cur: CaptionWordProp[] = [];
  const flush = () => {
    if (cur.length) groups.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end + 0.15 });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (prev && (w.start - prev.end > 0.9 || cur.length >= maxWords || chars > maxChars || /[.!?]$/.test(prev.text))) flush();
    cur.push(w);
  }
  flush();
  return groups;
}

export function activeGroup(groups: CaptionGroup[], t: number): CaptionGroup | null {
  for (const g of groups) if (t >= g.start && t < g.end) return g;
  return null;
}

export function activeWordIndex(group: CaptionGroup, t: number): number {
  let idx = 0;
  for (let i = 0; i < group.words.length; i++) if (t >= group.words[i].start) idx = i;
  return idx;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
