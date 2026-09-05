import { newId } from "@/lib/ids";
import type { CaptionWord, EditCut, TranscriptWord } from "@/lib/types";
import { FILLERS, normalizeToken, prefixOverlap, similarity, splitSentences, tokenize } from "./text";

// Automatic cleanup pass. Given word-level transcript + the script the creator
// read from, produce a list of proposed cuts (all reversible by the user):
//   retake      – repeated attempt at the same line; the best take is kept
//   false_start – a short aborted attempt ("so the— so the thing is…")
//   filler      – um / uh / hesitation "like"
//   pause       – long silence trimmed down
//   lead / tail – dead air at the start and end

const PAUSE_SPLIT = 0.6; // gap that starts a new utterance
const MAX_PAUSE = 0.8; // longer gaps are shortened
const PAUSE_KEEP = 0.2; // silence left on each side of a trimmed pause
const RETAKE_SIM = 0.55;
const SCRIPT_MATCH_MIN = 0.4;

interface WordInfo extends TranscriptWord {
  i: number;
  tok: string;
  filler: boolean;
}

export interface Segment {
  index: number;
  from: number; // word index (inclusive)
  to: number; // word index (inclusive)
  start: number;
  end: number;
  tokens: string[]; // normalised, fillers removed
  text: string;
  fillers: number;
  hesitations: number;
  scriptIdx: number;
  scriptSim: number;
}

export interface CleanupResult {
  cuts: EditCut[];
  segments: Segment[];
  stats: { retakes: number; fillers: number; pauses: number; removedSec: number };
}

export function detectCuts(words: TranscriptWord[], duration: number, script: string | null): CleanupResult {
  const infos: WordInfo[] = words.map((w, i) => {
    const tok = normalizeToken(w.text);
    return { ...w, i, tok, filler: FILLERS.has(tok) };
  });
  const segments = segment(infos);
  const scriptSentences = script ? splitSentences(script).map(tokenize).filter((t) => t.length) : [];
  for (const seg of segments) {
    let best = -1;
    let bestSim = 0;
    scriptSentences.forEach((s, idx) => {
      const sim = similarity(seg.tokens, s);
      if (sim > bestSim) {
        bestSim = sim;
        best = idx;
      }
    });
    seg.scriptIdx = bestSim >= SCRIPT_MATCH_MIN ? best : -1;
    seg.scriptSim = bestSim;
  }

  const cuts: EditCut[] = [];
  const cutWords = new Set<number>();

  // ---- 1. repeated attempts ----
  const groups = findRetakeGroups(segments);
  let retakes = 0;
  for (const group of groups) {
    const members = group.map((i) => segments[i]);
    const maxLen = Math.max(...members.map((m) => m.tokens.length));
    const scored = members.map((m, k) => ({
      seg: m,
      score:
        m.scriptSim * 3 -
        m.fillers * 0.4 -
        m.hesitations * 0.3 +
        (m.tokens.length / Math.max(1, maxLen)) * 1.0 +
        (k === members.length - 1 ? 0.15 : 0),
    }));
    const keep = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]).seg;
    const groupId = newId("g");
    const first = members[0].index;
    const last = members[members.length - 1].index;
    for (const m of members) {
      if (m === keep) continue;
      retakes++;
      const isFalseStart = m.tokens.length < Math.max(3, keep.tokens.length * 0.5);
      pushSegmentCut(cuts, infos, m, isFalseStart ? "false_start" : "retake", groupId, keep, cutWords);
    }
    // short restart utterances between members ("no wait", "again", "sorry")
    for (let k = first + 1; k < last; k++) {
      const s = segments[k];
      if (group.includes(k) || cutWords.has(s.from)) continue;
      if (s.tokens.length <= 4 && s.end - s.start <= 2.5 && s.scriptSim < SCRIPT_MATCH_MIN) {
        pushSegmentCut(cuts, infos, s, "false_start", groupId, keep, cutWords);
      }
    }
  }

  // ---- 2. fillers ----
  let fillers = 0;
  for (const w of infos) {
    if (cutWords.has(w.i)) continue;
    const prev = infos[w.i - 1];
    const next = infos[w.i + 1];
    const gapBefore = prev ? w.start - prev.end : 1;
    const gapAfter = next ? next.start - w.end : 1;
    let isFiller = w.filler;
    let detail = `"${w.text}"`;
    if (!isFiller && w.tok === "like" && gapBefore >= 0.18 && gapAfter >= 0.18) {
      isFiller = true;
      detail = 'hesitation "like"';
    }
    if (!isFiller && w.tok === "you" && next?.tok === "know" && gapBefore >= 0.15 && !cutWords.has(next.i)) {
      const after = infos[next.i + 1];
      const gapAfter2 = after ? after.start - next.end : 1;
      if (gapAfter2 >= 0.15) {
        fillers++;
        cutWords.add(w.i);
        cutWords.add(next.i);
        cuts.push({
          id: newId("c"),
          start: clamp(w.start - Math.min(0.04, gapBefore / 2), 0, duration),
          end: clamp(next.end + Math.min(0.04, gapAfter2 / 2), 0, duration),
          reason: "filler",
          enabled: true,
          detail: '"you know"',
        });
        continue;
      }
    }
    if (!isFiller) continue;
    fillers++;
    cutWords.add(w.i);
    cuts.push({
      id: newId("c"),
      start: clamp(w.start - Math.min(0.04, Math.max(0, gapBefore) / 2), 0, duration),
      end: clamp(w.end + Math.min(0.04, Math.max(0, gapAfter) / 2), 0, duration),
      reason: "filler",
      enabled: true,
      detail,
    });
  }

  // ---- 3. long pauses between kept words ----
  const kept = infos.filter((w) => !cutWords.has(w.i));
  let pauses = 0;
  for (let k = 0; k + 1 < kept.length; k++) {
    const a = kept[k];
    const b = kept[k + 1];
    // Silence that survives the cuts above, possibly split into several slivers.
    const remaining = subtractCuts(a.end, b.start, cuts);
    const total = remaining.reduce((s, [gs, ge]) => s + (ge - gs), 0);
    if (total <= MAX_PAUSE) continue;
    const keepStart = a.end + PAUSE_KEEP;
    const keepEnd = b.start - PAUSE_KEEP;
    let counted = false;
    for (const [gs, ge] of remaining) {
      const cs = Math.max(gs, keepStart);
      const ce = Math.min(ge, keepEnd);
      if (ce - cs <= 0.03) continue;
      if (!counted) {
        pauses++;
        counted = true;
      }
      cuts.push({
        id: newId("c"),
        start: cs,
        end: ce,
        reason: "pause",
        enabled: true,
        detail: `${total.toFixed(1)}s pause`,
      });
    }
  }

  // ---- 4. dead air ----
  if (kept.length) {
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (first.start > 0.5) {
      cuts.push({ id: newId("c"), start: 0, end: Math.max(0, first.start - 0.3), reason: "lead", enabled: true, detail: "Dead air at start" });
    }
    if (duration - last.end > 0.6) {
      cuts.push({ id: newId("c"), start: Math.min(duration, last.end + 0.35), end: duration, reason: "tail", enabled: true, detail: "Dead air at end" });
    }
  }

  const finalCuts = cuts
    .map((c) => ({ ...c, start: +Math.max(0, c.start).toFixed(3), end: +Math.min(duration, c.end).toFixed(3) }))
    .filter((c) => c.end - c.start > 0.02)
    .sort((a, b) => a.start - b.start);

  const removedSec = mergedRanges(finalCuts).reduce((s, r) => s + (r.end - r.start), 0);
  return { cuts: finalCuts, segments, stats: { retakes, fillers, pauses, removedSec: +removedSec.toFixed(2) } };
}

function segment(words: WordInfo[]): Segment[] {
  const segs: Segment[] = [];
  let cur: WordInfo[] = [];
  const flush = () => {
    if (!cur.length) return;
    const tokens = cur.filter((w) => !w.filler && w.tok).map((w) => w.tok);
    let hesitations = 0;
    for (let k = 1; k < cur.length; k++) if (cur[k].start - cur[k - 1].end > 0.35) hesitations++;
    segs.push({
      index: segs.length,
      from: cur[0].i,
      to: cur[cur.length - 1].i,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      tokens,
      text: cur.map((w) => w.text).join(" "),
      fillers: cur.filter((w) => w.filler).length,
      hesitations,
      scriptIdx: -1,
      scriptSim: 0,
    });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    if (prev) {
      const gap = w.start - prev.end;
      const sentenceEnd = /[.!?…]["')\]]*$/.test(prev.text);
      if (gap > PAUSE_SPLIT || (sentenceEnd && gap > 0.12)) flush();
    }
    cur.push(w);
  }
  flush();
  return segs;
}

/** Union-find over segments that look like attempts at the same line. */
function findRetakeGroups(segments: Segment[]): number[][] {
  const parent = segments.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    if (a.tokens.length < 2) continue;
    for (let j = i + 1; j < Math.min(segments.length, i + 5); j++) {
      const b = segments[j];
      if (b.tokens.length < 2) continue;
      // Do not cross a long span of unrelated speech.
      if (b.start - a.end > 20) break;
      const sim = similarity(a.tokens, b.tokens);
      const prefix = a.tokens.length < b.tokens.length ? prefixOverlap(a.tokens, b.tokens) : 0;
      const sameScriptLine = a.scriptIdx >= 0 && a.scriptIdx === b.scriptIdx;
      const isRepeat =
        sim >= RETAKE_SIM ||
        (a.tokens.length <= 8 && prefix >= 0.75) ||
        (sameScriptLine && sim >= 0.3) ||
        (sameScriptLine && prefix >= 0.6);
      if (isRepeat) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  segments.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((x, y) => x - y));
}

function pushSegmentCut(
  cuts: EditCut[],
  infos: WordInfo[],
  seg: Segment,
  reason: "retake" | "false_start",
  groupId: string,
  keep: Segment,
  cutWords: Set<number>,
): void {
  const prev = infos[seg.from - 1];
  const next = infos[seg.to + 1];
  const gapBefore = prev ? seg.start - prev.end : 1;
  const gapAfter = next ? next.start - seg.end : 1;
  for (let k = seg.from; k <= seg.to; k++) cutWords.add(k);
  cuts.push({
    id: newId("c"),
    start: seg.start - Math.min(0.15, Math.max(0, gapBefore) / 2),
    end: seg.end + Math.min(0.15, Math.max(0, gapAfter) / 2),
    reason,
    enabled: true,
    groupId,
    detail:
      reason === "retake"
        ? `Repeated line: "${truncate(seg.text, 60)}" (kept the take at ${fmt(keep.start)})`
        : `Aborted attempt: "${truncate(seg.text, 60)}"`,
  });
}

function subtractCuts(start: number, end: number, cuts: EditCut[]): Array<[number, number]> {
  let ranges: Array<[number, number]> = [[start, end]];
  for (const c of cuts) {
    const next: Array<[number, number]> = [];
    for (const [s, e] of ranges) {
      if (c.end <= s || c.start >= e) next.push([s, e]);
      else {
        if (c.start > s) next.push([s, c.start]);
        if (c.end < e) next.push([c.end, e]);
      }
    }
    ranges = next;
  }
  return ranges.filter(([s, e]) => e > s);
}

// ---------- Applying cuts ----------

export interface Range {
  start: number;
  end: number;
}

export function mergedRanges(cuts: EditCut[]): Range[] {
  const enabled = cuts.filter((c) => c.enabled && c.end > c.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const c of enabled) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end);
    else out.push({ start: c.start, end: c.end });
  }
  return out;
}

/** Complement of the enabled cuts inside [0, duration]; tiny slivers are dropped. */
export function keepRanges(duration: number, cuts: EditCut[]): Range[] {
  const removed = mergedRanges(cuts);
  const keeps: Range[] = [];
  let cursor = 0;
  for (const r of removed) {
    if (r.start > cursor) keeps.push({ start: cursor, end: Math.min(r.start, duration) });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration });
  return keeps.filter((k) => k.end - k.start >= 0.12);
}

export function outputDuration(keeps: Range[]): number {
  return keeps.reduce((s, k) => s + (k.end - k.start), 0);
}

/** Map a source timestamp to the output timeline (null if it was cut). */
export function mapToOutput(t: number, keeps: Range[]): number | null {
  let acc = 0;
  for (const k of keeps) {
    if (t < k.start) return null;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return null;
}

/** Nearest output time for a source timestamp (snaps into the closest kept range). */
export function mapToOutputClamped(t: number, keeps: Range[]): number {
  let acc = 0;
  for (const k of keeps) {
    if (t < k.start) return acc;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return acc;
}

/** Caption words on the output timeline, excluding anything inside a cut. */
export function buildCaptionWords(words: TranscriptWord[], keeps: Range[]): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    const inside = keeps.some((k) => mid >= k.start && mid <= k.end);
    if (!inside) continue;
    const s = mapToOutputClamped(w.start, keeps);
    const e = Math.max(s + 0.08, mapToOutputClamped(w.end, keeps));
    out.push({ text: w.text, start: +s.toFixed(3), end: +e.toFixed(3) });
  }
  // guarantee monotonic, non-overlapping words
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end) out[i].start = out[i - 1].end;
    if (out[i].end < out[i].start + 0.05) out[i].end = out[i].start + 0.05;
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
