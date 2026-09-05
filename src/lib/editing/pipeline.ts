import fs from "node:fs";
import path from "node:path";
import { getProject, updateProject } from "@/lib/db/repo";
import type { JobContext } from "@/lib/jobs";
import { extractAudio, ffmpeg, probe } from "@/lib/media/ffmpeg";
import { absPath, projectDir, relPath } from "@/lib/storage";
import type { Project, TakeRecording, User } from "@/lib/types";
import { buildCaptionWords, detectCuts, keepRanges } from "./cleanup";
import { transcribe } from "./transcribe";
import { autoSourceVisuals, extractKeyPhrases } from "./visuals";
import { renderVideo } from "./render";

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

  ctx.progress(0.3, "Transcribing");
  const script = project.finalScript || project.scripts.find((s) => s.id === project.selectedScriptId)?.text || null;
  const transcript = await transcribe(wav, { duration, scriptHint: script || undefined });
  fs.rmSync(wav, { force: true });

  ctx.progress(0.55, "Detecting retakes, fillers and pauses");
  const result = detectCuts(transcript.words, duration, script);
  const keeps = keepRanges(duration, result.cuts);
  const captions = buildCaptionWords(transcript.words, keeps);

  updateProject(projectId, (p) => {
    p.edit.transcript = transcript;
    p.edit.cuts = result.cuts;
    p.edit.captions = captions;
    p.edit.visuals = [];
    p.edit.analysis = { status: "running", jobId: ctx.id, stats: result.stats };
  });

  ctx.progress(0.62, "Finding visuals");
  const visuals = await autoSourceVisuals(projectId, captions, user.niche, (f, msg) => ctx.progress(0.62 + f * 0.3, msg));
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
    onProgress: (f, m) => ctx.progress(f, m),
  });
  updateProject(projectId, (p) => {
    p.edit.render = { status: "done", jobId: ctx.id, file: result.file, format: p.edit.format, aspect: p.edit.aspect, durationSec: result.durationSec };
  });
  return result;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
