import fs from "node:fs";
import path from "node:path";
import { getProject, updateProject } from "@/lib/db/repo";
import type { JobContext } from "@/lib/jobs";
import { extractAudio, ffmpeg, probe } from "@/lib/media/ffmpeg";
import { absPath, projectDir, relPath } from "@/lib/storage";
import type { Project, TakeRecording, User } from "@/lib/types";
import { createHash } from "node:crypto";
import { buildCaptionWords, detectCuts, keepRanges, outputDuration } from "./cleanup";
import { transcribe } from "./transcribe";
import { autoSourceVisuals, extractKeyPhrases } from "./visuals";
import { renderVideo } from "./render";
import { detectSilences, silenceCuts } from "./silence";
import { remotionCapability, renderWithRemotion } from "./remotion/renderer";
import { buildRemotionProps } from "./remotion/buildProps";
import { type EditBrief, type EditCut } from "@/lib/types";

// Orchestrates the automatic first pass when a project enters Editing.

export function selectedTakes(project: Project): TakeRecording[] {
  const ready = project.takes.filter((t) => t.status === "ready");
  const selected = ready.filter((t) => t.selected);
  const list = selected.length ? selected : ready.filter((t) => t.primary);
  const final = list.length ? list : ready.slice(0, 1);
  // primary take first, then in recording order
  return [...final].sort((a, b) => Number(b.primary) - Number(a.primary) || a.createdAt.localeCompare(b.createdAt));
}

/** Concatenate the selected takes into one normalised source file. */
export async function prepareSource(project: Project, ctx: JobContext): Promise<{ file: string; duration: number }> {
  const takes = selectedTakes(project);
  if (!takes.length) throw new Error("No ready takes to edit. Record or upload a take first.");
  const dir = projectDir(project.id, "edit");
  const out = path.join(dir, `source-${Date.now().toString(36)}.mp4`);
  // clear old sources
  for (const f of fs.readdirSync(dir)) if (f.startsWith("source-")) fs.rmSync(path.join(dir, f), { force: true });

  if (takes.length === 1) {
    fs.copyFileSync(absPath(takes[0].file), out);
  } else {
    ctx.progress(0.02, `Joining ${takes.length} takes`);
    const infos = await Promise.all(takes.map((t) => probe(absPath(t.file))));
    const W = infos[0].width;
    const H = infos[0].height;
    const args: string[] = [];
    takes.forEach((t) => args.push("-i", absPath(t.file)));
    const chains = takes
      .map(
        (_, i) =>
          `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`,
      )
      .join(";");
    const concatIn = takes.map((_, i) => `[v${i}][a${i}]`).join("");
    args.push(
      "-filter_complex",
      `${chains};${concatIn}concat=n=${takes.length}:v=1:a=1[v][a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      out,
    );
    const total = infos.reduce((s, i) => s + i.duration, 0);
    await ffmpeg(args, { expectedDuration: total, onProgress: (f) => ctx.progress(0.02 + f * 0.15, "Joining takes") });
  }
  const info = await probe(out);
  return { file: relPath(out), duration: info.duration };
}

export async function analyzeProject(projectId: string, user: User, ctx: JobContext): Promise<void> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");

  const { file, duration } = await prepareSource(project, ctx);
  updateProject(projectId, (p) => {
    p.edit.sourceFile = file;
    p.edit.sourceDuration = duration;
  });

  ctx.progress(0.2, "Extracting audio");
  const wav = path.join(projectDir(projectId, "edit"), "audio.wav");
  await extractAudio(absPath(file), wav);

  ctx.progress(0.25, "Listening for silences");
  const brief = project.edit.brief;
  const silences = await detectSilences(wav).catch(() => []);
  const speechRanges = speechFromSilences(silences, duration);

  ctx.progress(0.3, "Transcribing");
  const script = project.finalScript || project.scripts.find((s) => s.id === project.selectedScriptId)?.text || null;
  const transcript = await transcribe(wav, { duration, scriptHint: script || undefined, speechRanges });
  fs.rmSync(wav, { force: true });

  ctx.progress(0.55, "Detecting retakes, fillers and pauses");
  const result = detectCuts(transcript.words, duration, script);
  // Audio-domain silences catch dead air the transcript timing misses.
  const extra = silenceCuts(silences.filter((s) => s.end - s.start >= 0.8), result.cuts, duration);
  result.cuts = [...result.cuts, ...extra].sort((a, b) => a.start - b.start);
  result.stats.pauses += extra.length;
  applyBriefToCuts(result.cuts, brief);
  result.stats.removedSec = +(duration - outputDuration(keepRanges(duration, result.cuts))).toFixed(2);
  const keeps = keepRanges(duration, result.cuts);
  const captions = buildCaptionWords(transcript.words, keeps);

  updateProject(projectId, (p) => {
    p.edit.transcript = transcript;
    p.edit.cuts = result.cuts;
    p.edit.captions = captions;
    p.edit.visuals = [];
    p.edit.analysis = { status: "running", jobId: ctx.id, stats: result.stats };
  });

  const wantsVisuals = (brief?.broll ?? true) && (project.edit.format === "split" || project.edit.format === "overlay");
  ctx.progress(0.62, wantsVisuals ? "Finding visuals" : "Skipping visuals");
  const visuals = wantsVisuals ? await autoSourceVisuals(projectId, captions, user.niche, (f, msg) => ctx.progress(0.62 + f * 0.3, msg)) : [];
  ctx.progress(0.94, "Picking key phrases");
  const keyPhrases = await extractKeyPhrases(captions);

  updateProject(projectId, (p) => {
    p.edit.visuals = visuals;
    p.edit.keyPhrases = keyPhrases;
    p.edit.analysis = { status: "done", jobId: ctx.id, stats: result.stats };
  });
}

/** Recompute output-timeline captions and shift visuals after cuts change. */
export function recomputeAfterCuts(project: Project): void {
  const { edit } = project;
  if (!edit.transcript || !edit.sourceDuration) return;
  const keeps = keepRanges(edit.sourceDuration, edit.cuts);
  const oldCaptions = edit.captions || [];
  const fresh = buildCaptionWords(edit.transcript.words, keeps);
  // Preserve user text edits by matching on source order where possible
  const edited = new Map(oldCaptions.map((c, i) => [i, c.text] as const));
  if (oldCaptions.length === fresh.length) {
    fresh.forEach((c, i) => {
      const t = edited.get(i);
      if (t) c.text = t;
    });
  }
  edit.captions = fresh;
  const total = fresh.length ? fresh[fresh.length - 1].end : 0;
  // Keep visuals proportional: clamp to the new duration
  for (const v of edit.visuals) {
    v.start = Math.min(v.start, Math.max(0, total - 0.5));
    v.end = Math.min(v.end, total);
  }
  if (edit.visuals.length && total > 0) edit.visuals[edit.visuals.length - 1].end = total;
}

export async function renderProject(projectId: string, user: User, ctx: JobContext): Promise<{ file: string; durationSec: number }> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");
  const { edit } = project;
  if (!edit.sourceFile || !edit.sourceDuration) throw new Error("Run the cleanup pass before rendering.");

  // Remotion (animated captions, B-roll motion, titles) when a headless Chrome is
  // available; otherwise the ffmpeg/ASS renderer, which needs nothing extra.
  const cap = remotionCapability();
  if (cap.ok && edit.format !== "videouse") {
    try {
      const clean = await produceClean(projectId, ctx, 0, 0.25);
      const fresh = getProject(projectId)!;
      const props = buildRemotionProps(fresh, user);
      const dir = projectDir(projectId, "renders");
      const outPath = path.join(dir, `final-${fresh.edit.format}-${fresh.edit.aspect.replace(":", "x")}-${Date.now().toString(36)}.mp4`);
      await renderWithRemotion({ props, cleanFile: absPath(clean.file), outPath, onProgress: (f, m) => ctx.progress(0.25 + f * 0.75, m) });
      const info = await probe(outPath);
      const file = relPath(outPath);
      updateProject(projectId, (p) => {
        p.edit.render = { status: "done", jobId: ctx.id, file, format: p.edit.format, aspect: p.edit.aspect, durationSec: info.duration, engine: "remotion" };
      });
      return { file, durationSec: info.duration };
    } catch (err) {
      console.error("[render] Remotion failed, falling back to ffmpeg:", err);
      updateProject(projectId, (p) => {
        p.edit.render = { ...(p.edit.render || { status: "running" }), warning: `Remotion failed (${err instanceof Error ? err.message.slice(0, 200) : String(err)}); rendered with ffmpeg instead.` };
      });
    }
  }
  const captions = edit.captions || [];
  const total = captions.length ? captions[captions.length - 1].end : 0;
  const visuals = edit.visuals.map((v, i, arr) => (i === arr.length - 1 && total > v.end ? { ...v, end: total + 1 } : v));
  const result = await renderVideo({
    projectId,
    sourceFile: edit.sourceFile,
    sourceDuration: edit.sourceDuration,
    cuts: edit.cuts,
    captions,
    captionStyle: edit.captionStyle,
    format: edit.format,
    aspect: edit.aspect,
    visuals,
    keyPhrases: edit.keyPhrases || [],
    lowerThird: { name: user.handle ? `@${user.handle.replace(/^@/, "")}` : user.name, subtitle: user.niche ? `${capitalize(user.niche)} creator` : "Creator" },
    facePosition: edit.facePosition || "bottom",
    onProgress: (f, m) => ctx.progress(f, m),
  });
  updateProject(projectId, (p) => {
    p.edit.render = { status: "done", jobId: ctx.id, file: result.file, format: p.edit.format, aspect: p.edit.aspect, durationSec: result.durationSec, engine: "ffmpeg", warning: p.edit.render?.warning };
  });
  return result;
}

function speechFromSilences(silences: Array<{ start: number; end: number }>, duration: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor) out.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out;
}

/** The brief decides which kinds of cuts are applied by default. */
function applyBriefToCuts(cuts: EditCut[], brief: EditBrief | undefined): void {
  if (!brief) return;
  for (const c of cuts) {
    if (!brief.removeFillers && c.reason === "filler") c.enabled = false;
    if (!brief.removeSilences && (c.reason === "pause" || c.reason === "lead" || c.reason === "tail")) c.enabled = false;
    if (!brief.keepBestTakes && (c.reason === "retake" || c.reason === "false_start" || c.reason === "off_script")) c.enabled = false;
  }
}

/**
 * Cuts + audio cleanup applied, no overlays. Used as the Remotion input and as
 * a faithful preview. Cached by source + enabled cut ranges.
 */
export async function produceClean(projectId: string, ctx: JobContext, from = 0, to = 1): Promise<{ file: string; duration: number }> {
  const project = getProject(projectId);
  if (!project?.edit.sourceFile || !project.edit.sourceDuration) throw new Error("No source to clean");
  const { edit } = project;
  const sourceFile = project.edit.sourceFile;
  const sourceDuration = project.edit.sourceDuration;
  const keeps = keepRanges(sourceDuration, edit.cuts);
  if (!keeps.length) throw new Error("Nothing left after the cuts");
  const key = createHash("sha1").update(sourceFile).update(JSON.stringify(keeps.map((k) => [k.start, k.end]))).digest("hex").slice(0, 12);
  const cutPoints: number[] = [];
  let acc = 0;
  for (const k of keeps) {
    if (acc > 0) cutPoints.push(+acc.toFixed(3));
    acc += k.end - k.start;
  }
  if (edit.cleanKey === key && edit.cleanFile && fs.existsSync(absPath(edit.cleanFile))) {
    updateProject(projectId, (p) => {
      p.edit.cutPoints = cutPoints;
    });
    return { file: edit.cleanFile, duration: edit.cleanDuration || outputDuration(keeps) };
  }
  ctx.progress(from, "Cutting and cleaning audio");
  const sel = keeps.map((k) => `between(t,${k.start.toFixed(3)},${k.end.toFixed(3)})`).join("+");
  const out = path.join(projectDir(projectId, "edit"), `clean-${key}.mp4`);
  const total = outputDuration(keeps);
  await ffmpeg(
    [
      "-i",
      absPath(sourceFile),
      "-filter_complex",
      `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${sel}',asetpts=N/SR/TB,afftdn=nf=-25,highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-g",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-t",
      (total + 0.2).toFixed(3),
      out,
    ],
    { expectedDuration: total, onProgress: (f) => ctx.progress(from + f * (to - from), "Cutting and cleaning audio") },
  );
  const info = await probe(out);
  const file = relPath(out);
  // drop older clean files
  for (const f of fs.readdirSync(projectDir(projectId, "edit"))) if (f.startsWith("clean-") && f !== path.basename(out)) fs.rmSync(path.join(projectDir(projectId, "edit"), f), { force: true });
  updateProject(projectId, (p) => {
    p.edit.cleanFile = file;
    p.edit.cleanKey = key;
    p.edit.cleanDuration = info.duration;
    p.edit.cutPoints = cutPoints;
  });
  return { file, duration: info.duration };
}

/** Everything in one go: wait for footage, analyze, cut, render. */
export async function autoEditProject(projectId: string, user: User, ctx: JobContext): Promise<{ file: string; durationSec: number }> {
  const stage = (s: string) => updateProject(projectId, (p) => {
    p.edit.auto = { ...(p.edit.auto || { status: "running" }), status: "running", jobId: ctx.id, stage: s };
  });
  stage("waiting");
  for (let i = 0; i < 300; i++) {
    const p = getProject(projectId);
    if (!p) throw new Error("Project not found");
    if (p.takes.some((t) => t.status === "ready")) break;
    if (p.takes.length && p.takes.every((t) => t.status === "failed")) throw new Error(p.takes[0].error || "The footage could not be processed");
    ctx.progress(0.01, "Preparing your footage");
    await new Promise((r) => setTimeout(r, 2000));
  }
  stage("analyze");
  const scaled = (from: number, to: number): JobContext => ({ ...ctx, progress: (f, m) => ctx.progress(from + f * (to - from), m) });
  await analyzeProject(projectId, user, scaled(0.03, 0.55));
  stage("render");
  const result = await renderProject(projectId, user, scaled(0.55, 1));
  updateProject(projectId, (p) => {
    p.edit.auto = { status: "done", jobId: ctx.id, stage: "done" };
  });
  return result;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
