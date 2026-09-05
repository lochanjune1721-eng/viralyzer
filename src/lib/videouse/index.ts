import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { absPath, projectDir, relPath } from "@/lib/storage";
import type { CaptionWord, Edl, EdlRange, Project, TranscriptWord } from "@/lib/types";
import { keepRanges } from "@/lib/editing/cleanup";

// Drives the vendored video-use engine (vendor/video-use, MIT, Browser Use):
// packed transcripts for the planner, EDL rendering with grade + fades +
// subtitles-last + loudnorm, and the filmstrip/waveform timeline view.

export const VIDEOUSE_DIR = path.join(process.cwd(), "vendor", "video-use");
const HELPERS = path.join(VIDEOUSE_DIR, "helpers");

export const GRADE_PRESETS = ["auto", "subtle", "neutral_punch", "warm_cinematic", "none"] as const;
export const SUBTITLE_STYLES = ["bold-overlay", "none"] as const;

export function pythonPath(): string {
  return process.env.PYTHON_PATH || "python3";
}

export interface VideoUseCapability {
  ok: boolean;
  reason: string | null;
}

let capCache: VideoUseCapability | null = null;

/** python3 + the helper deps must be present. Cached for the process lifetime. */
export function videoUseCapability(): VideoUseCapability {
  if (capCache) return capCache;
  if (!fs.existsSync(path.join(HELPERS, "render.py"))) {
    return (capCache = { ok: false, reason: "vendor/video-use helpers are missing from this deployment." });
  }
  const res = spawnSync(pythonPath(), ["-c", "import requests, numpy, PIL"], { encoding: "utf8", timeout: 20000 });
  if (res.error || res.status !== 0) {
    return (capCache = {
      ok: false,
      reason: `Python 3 with requests, numpy and pillow is required for the video-use engine (pip install -r vendor/video-use/requirements.txt). ${res.error ? res.error.message : (res.stderr || "").trim().split("\n").pop() || ""}`.trim(),
    });
  }
  return (capCache = { ok: true, reason: null });
}

// ---------- Transcript artifacts ----------

/** Write our transcript in Scribe's JSON shape so the Python helpers can read it. */
export function writeTranscriptJson(projectId: string, sourceName: string, words: TranscriptWord[]): string {
  const dir = path.join(projectDir(projectId, "videouse"), "transcripts");
  fs.mkdirSync(dir, { recursive: true });
  const entries: Array<Record<string, unknown>> = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    entries.push({ type: "word", text: w.text, start: w.start, end: w.end, speaker_id: "speaker_0" });
    const next = words[i + 1];
    if (next && next.start > w.end + 0.005) entries.push({ type: "spacing", text: " ", start: w.end, end: next.start });
  }
  const file = path.join(dir, `${sourceName}.json`);
  fs.writeFileSync(file, JSON.stringify({ text: words.map((w) => w.text).join(" "), words: entries }, null, 1));
  return file;
}

export interface Phrase {
  start: number;
  end: number;
  text: string;
}

/** Phrase-level view (breaks on silences >= 0.5s), the planner's primary reading surface. */
export function packPhrases(words: TranscriptWord[], silence = 0.5): Phrase[] {
  const out: Phrase[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    if (prev && w.start - prev.end >= silence) flush();
    cur.push(w);
  }
  flush();
  return out;
}

export function packedMarkdown(name: string, words: TranscriptWord[]): string {
  const phrases = packPhrases(words);
  const dur = phrases.length ? phrases[phrases.length - 1].end - phrases[0].start : 0;
  const fmt = (s: number) => s.toFixed(2).padStart(6, "0");
  return [`## ${name}  (duration: ${dur.toFixed(1)}s, ${phrases.length} phrases)`, ...phrases.map((p) => `  [${fmt(p.start)}-${fmt(p.end)}] ${p.text}`)].join("\n");
}

// ---------- EDL helpers ----------

const PAD_BEFORE = 0.05;
const PAD_AFTER = 0.08;

/** Snap a range to word boundaries (Hard Rule 6) and pad it (Hard Rule 7). */
export function snapRange(range: EdlRange, words: TranscriptWord[], duration: number): EdlRange {
  if (!words.length) return { ...range, start: Math.max(0, range.start), end: Math.min(duration, range.end) };
  let first: TranscriptWord | null = null;
  let last: TranscriptWord | null = null;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid >= range.start - 0.15 && mid <= range.end + 0.15) {
      if (!first) first = w;
      last = w;
    }
  }
  if (!first || !last) return { ...range, start: Math.max(0, range.start), end: Math.min(duration, range.end) };
  const idxFirst = words.indexOf(first);
  const idxLast = words.indexOf(last);
  const prevEnd = idxFirst > 0 ? words[idxFirst - 1].end : 0;
  const nextStart = idxLast + 1 < words.length ? words[idxLast + 1].start : duration;
  const start = Math.max(prevEnd, first.start - PAD_BEFORE, 0);
  const end = Math.min(nextStart, last.end + PAD_AFTER, duration);
  return { ...range, start: +start.toFixed(3), end: +end.toFixed(3), quote: range.quote || words.slice(idxFirst, idxLast + 1).map((w) => w.text).join(" ").slice(0, 120) };
}

/** Build the starting EDL from the automatic cleanup pass (kept ranges). */
export function edlFromCuts(project: Project): Edl {
  const { edit } = project;
  const duration = edit.sourceDuration || 0;
  const words = edit.transcript?.words || [];
  const keeps = keepRanges(duration, edit.cuts);
  const ranges: EdlRange[] = keeps.map((k, i) => {
    const inside = words.filter((w) => (w.start + w.end) / 2 >= k.start && (w.start + w.end) / 2 <= k.end);
    return {
      source: "main",
      start: +k.start.toFixed(3),
      end: +k.end.toFixed(3),
      beat: `SEGMENT ${i + 1}`,
      quote: inside.map((w) => w.text).join(" ").slice(0, 120),
      reason: "Kept by the automatic cleanup pass",
    };
  });
  return { version: 1, sources: { main: "main" }, ranges, grade: edit.videouse?.grade || "auto", subtitles: edit.videouse?.subtitleStyle || "bold-overlay", total_duration_s: +ranges.reduce((s, r) => s + (r.end - r.start), 0).toFixed(2) };
}

export function edlDuration(edl: Edl): number {
  return +edl.ranges.reduce((s, r) => s + Math.max(0, r.end - r.start), 0).toFixed(2);
}

export function sanitizeEdl(edl: Edl, project: Project): Edl {
  const words = project.edit.transcript?.words || [];
  const duration = project.edit.sourceDuration || 0;
  const ranges = (edl.ranges || [])
    .map((r) => ({ ...r, source: "main", start: Number(r.start), end: Number(r.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => snapRange(r, words, duration))
    .filter((r) => r.end - r.start >= 0.15)
    .sort((a, b) => a.start - b.start);
  const grade = typeof edl.grade === "string" && edl.grade.trim() ? edl.grade.trim() : "auto";
  const subtitles = edl.subtitles === "none" ? "none" : "bold-overlay";
  const clean: Edl = { version: 1, sources: { main: "main" }, ranges, grade, subtitles, total_duration_s: 0 };
  clean.total_duration_s = edlDuration(clean);
  return clean;
}

/** Caption words on the EDL's output timeline (for our own preview + captions editor). */
export function captionsForEdl(edl: Edl, words: TranscriptWord[]): CaptionWord[] {
  const out: CaptionWord[] = [];
  let offset = 0;
  for (const r of edl.ranges) {
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < r.start || mid > r.end) continue;
      out.push({ text: w.text, start: +(Math.max(r.start, w.start) - r.start + offset).toFixed(3), end: +(Math.min(r.end, w.end) - r.start + offset).toFixed(3) });
    }
    offset += r.end - r.start;
  }
  return out;
}

// ---------- Rendering through render.py ----------

export interface VideoUseRenderResult {
  file: string;
  durationSec: number;
  log: string;
}

export async function renderEdl(
  project: Project,
  edl: Edl,
  opts: { preview?: boolean; onProgress?: (fraction: number, message: string) => void } = {},
): Promise<VideoUseRenderResult> {
  const cap = videoUseCapability();
  if (!cap.ok) throw new Error(cap.reason || "video-use engine unavailable");
  if (!project.edit.sourceFile) throw new Error("No source video; run the cleanup pass first.");
  if (!edl.ranges.length) throw new Error("The EDL has no ranges to render.");

  const editDir = projectDir(project.id, "videouse");
  const sourceAbs = absPath(project.edit.sourceFile);
  const words = project.edit.transcript?.words || [];
  writeTranscriptJson(project.id, "main", words);

  const edlOnDisk = { ...edl, sources: { main: sourceAbs } };
  const edlPath = path.join(editDir, "edl.json");
  fs.writeFileSync(edlPath, JSON.stringify(edlOnDisk, null, 2));
  const stamp = Date.now().toString(36);
  const outPath = path.join(projectDir(project.id, "renders"), `videouse-${opts.preview ? "preview" : "final"}-${stamp}.mp4`);

  const args = [path.join(HELPERS, "render.py"), edlPath, "-o", outPath, "--fps", "30"];
  if (opts.preview) args.push("--preview");
  if (edl.subtitles === "none") args.push("--no-subtitles");
  else args.push("--build-subtitles");

  const total = edl.ranges.length;
  let log = "";
  const res = await runPython(args, (line) => {
    log += line + "\n";
    const m = /^\s*\[(\d+)\]/.exec(line);
    if (m) opts.onProgress?.(0.05 + (0.55 * (Number(m[1]) + 1)) / Math.max(1, total), `Extracting segment ${Number(m[1]) + 1} of ${total}`);
    else if (/^concat/.test(line)) opts.onProgress?.(0.65, "Joining segments losslessly");
    else if (/master SRT/.test(line)) opts.onProgress?.(0.7, "Building subtitles");
    else if (/^compositing/.test(line)) opts.onProgress?.(0.75, "Burning subtitles");
    else if (/loudnorm pass 1/.test(line)) opts.onProgress?.(0.85, "Measuring loudness");
    else if (/loudnorm pass 2|loudnorm \(1-pass/.test(line)) opts.onProgress?.(0.92, "Normalising loudness");
  });
  if (res.code !== 0) throw new Error(`video-use render failed: ${(res.stderr || log).slice(-1500)}`);
  return { file: relPath(outPath), durationSec: edlDuration(edl), log };
}

/** Filmstrip + waveform + word labels for a time range of the source (or a render). */
export async function timelineView(project: Project, start: number, end: number, target: "source" | "render" = "source"): Promise<string> {
  const cap = videoUseCapability();
  if (!cap.ok) throw new Error(cap.reason || "video-use engine unavailable");
  const video = target === "render" && project.edit.render?.file ? absPath(project.edit.render.file) : project.edit.sourceFile ? absPath(project.edit.sourceFile) : null;
  if (!video) throw new Error("No video to inspect");
  const words = project.edit.transcript?.words || [];
  const transcript = target === "source" && words.length ? writeTranscriptJson(project.id, "main", words) : null;
  const dir = projectDir(project.id, "videouse/verify");
  const out = path.join(dir, `${target}-${start.toFixed(2)}-${end.toFixed(2)}.png`);
  if (fs.existsSync(out)) return relPath(out);
  const args = [path.join(HELPERS, "timeline_view.py"), video, String(start), String(end), "-o", out, "--n-frames", "8"];
  if (transcript) args.push("--transcript", transcript);
  const res = await runPython(args);
  if (res.code !== 0) throw new Error(`timeline view failed: ${res.stderr.slice(-800)}`);
  return relPath(out);
}

async function runPython(args: string[], onLine?: (line: string) => void): Promise<{ code: number; stdout: string; stderr: string }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), args, { cwd: HELPERS, env: { ...process.env, PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      buf += s;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        onLine?.(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 100_000) stderr = stderr.slice(-50_000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

