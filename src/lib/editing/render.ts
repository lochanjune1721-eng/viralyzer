import fs from "node:fs";
import path from "node:path";
import { escapeFilterPath, ffmpeg } from "@/lib/media/ffmpeg";
import { absPath, projectDir, relPath } from "@/lib/storage";
import type { AspectId, CaptionWord, FormatId, Visual } from "@/lib/types";
import { buildCaptionAss, frameSize, motionEvents } from "./captions";
import { keepRanges, outputDuration, type Range } from "./cleanup";
import type { EditCut, CaptionStyleId } from "@/lib/types";

// Builds and runs a single ffmpeg command that applies the cuts, cleans the
// audio, composes the chosen layout, burns word-synced captions and encodes
// the final deliverable.

export interface RenderOptions {
  projectId: string;
  sourceFile: string; // storage-relative
  sourceDuration: number;
  cuts: EditCut[];
  captions: CaptionWord[];
  captionStyle: CaptionStyleId;
  format: FormatId;
  aspect: AspectId;
  visuals: Visual[];
  keyPhrases: string[];
  lowerThird: { name: string; subtitle: string } | null;
  facePosition?: "top" | "bottom";
  onProgress?: (fraction: number, message?: string) => void;
}

export interface RenderResult {
  file: string; // storage-relative
  durationSec: number;
}

export function fontsDir(): string {
  return path.join(process.cwd(), "assets", "fonts");
}

function selectExpr(keeps: Range[]): string {
  if (!keeps.length) return "1";
  return keeps.map((k) => `between(t,${k.start.toFixed(3)},${k.end.toFixed(3)})`).join("+");
}

export function buildFilterGraph(opts: RenderOptions, keeps: Range[], assPath: string, imageInputs: Array<{ index: number; visual: Visual }>): string {
  const { w, h } = frameSize(opts.aspect);
  const landscape = opts.aspect === "16:9";
  const sel = selectExpr(keeps);
  const parts: string[] = [];

  parts.push(`[0:v]select='${sel}',setpts=N/FRAME_RATE/TB[vcut]`);
  parts.push(`[0:a]aselect='${sel}',asetpts=N/SR/TB,afftdn=nf=-25,highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

  const cover = (W: number, H: number) => `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  let last = "vcut";

  if (opts.format === "split") {
    const faceW = landscape ? w / 2 : w;
    const faceH = landscape ? h : h / 2;
    const faceBottom = opts.facePosition === "bottom";
    parts.push(`[vcut]${cover(faceW, faceH)}[face]`);
    parts.push(`color=c=0x0f0f12:s=${w}x${h}:r=30[bg]`);
    const faceX = landscape && faceBottom ? w / 2 : 0;
    const faceY = !landscape && faceBottom ? h / 2 : 0;
    parts.push(`[bg][face]overlay=${faceX}:${faceY}:shortest=1[base0]`);
    last = "base0";
    imageInputs.forEach(({ index, visual }, i) => {
      const tag = `img${i}`;
      parts.push(`[${index}:v]${cover(faceW, faceH)}[${tag}]`);
      const x = landscape ? (faceBottom ? 0 : w / 2) : 0;
      const y = landscape ? 0 : faceBottom ? 0 : h / 2;
      parts.push(
        `[${last}][${tag}]overlay=${x}:${y}:enable='between(t,${visual.start.toFixed(3)},${visual.end.toFixed(3)})':shortest=1[base${i + 1}]`,
      );
      last = `base${i + 1}`;
    });
    // divider line
    parts.push(
      landscape
        ? `[${last}]drawbox=x=${w / 2 - 3}:y=0:w=6:h=${h}:color=white@0.9:t=fill[split]`
        : `[${last}]drawbox=x=0:y=${h / 2 - 3}:w=${w}:h=6:color=white@0.9:t=fill[split]`,
    );
    last = "split";
  } else {
    parts.push(`[vcut]${cover(w, h)}[base0]`);
    last = "base0";
    if (opts.format === "overlay") {
      const boxW = Math.round(landscape ? w * 0.34 : w * 0.64);
      const boxH = Math.round(landscape ? h * 0.42 : h * 0.22);
      const border = Math.round(6 * (w / 1080));
      imageInputs.forEach(({ index, visual }, i) => {
        const tag = `img${i}`;
        parts.push(
          `[${index}:v]scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,pad=iw+${border * 2}:ih+${border * 2}:${border}:${border}:white,setsar=1[${tag}]`,
        );
        const x = landscape ? `main_w-overlay_w-${Math.round(w * 0.04)}` : `(main_w-overlay_w)/2`;
        const y = landscape ? `main_h*0.5-overlay_h/2` : `main_h*0.66-overlay_h`;
        parts.push(
          `[${last}][${tag}]overlay=${x}:${y}:enable='between(t,${visual.start.toFixed(3)},${visual.end.toFixed(3)})':shortest=1[base${i + 1}]`,
        );
        last = `base${i + 1}`;
      });
    }
  }

  parts.push(`[${last}]subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(fontsDir())}',format=yuv420p[vout]`);
  return parts.join(";");
}

export async function renderVideo(opts: RenderOptions): Promise<RenderResult> {
  const keeps = keepRanges(opts.sourceDuration, opts.cuts);
  const outDur = outputDuration(keeps);
  if (outDur < 0.5) throw new Error("Nothing left to render: almost everything was cut.");

  const dir = projectDir(opts.projectId, "renders");
  const stamp = Date.now().toString(36);
  const assPath = path.join(dir, `captions-${stamp}.ass`);
  const outPath = path.join(dir, `final-${opts.format}-${opts.aspect.replace(":", "x")}-${stamp}.mp4`);

  const landscape = opts.aspect === "16:9";
  const layout =
    opts.format === "split"
      ? { yFraction: landscape ? 0.9 : 0.47, marginLR: 60 }
      : opts.format === "overlay"
        ? { yFraction: landscape ? 0.9 : 0.8, marginLR: 60 }
        : { yFraction: landscape ? 0.88 : 0.76, marginLR: 60 };
  const extra = opts.format === "motion" ? motionEvents(opts.captions, opts.keyPhrases, opts.aspect, opts.lowerThird) : [];
  fs.writeFileSync(assPath, buildCaptionAss(opts.captions, opts.captionStyle, opts.aspect, layout, extra));

  const usesImages = opts.format === "split" || opts.format === "overlay";
  const imageVisuals = usesImages
    ? opts.visuals.filter((v) => v.file && fs.existsSync(absPath(v.file)) && v.end > v.start)
    : [];

  const args: string[] = ["-i", absPath(opts.sourceFile)];
  const imageInputs: Array<{ index: number; visual: Visual }> = [];
  imageVisuals.forEach((v, i) => {
    args.push("-loop", "1", "-framerate", "30", "-t", (outDur + 1).toFixed(2), "-i", absPath(v.file!));
    imageInputs.push({ index: i + 1, visual: v });
  });

  const graph = buildFilterGraph(opts, keeps, assPath, imageInputs);
  args.push(
    "-filter_complex",
    graph,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-t",
    (outDur + 0.2).toFixed(3),
    outPath,
  );

  opts.onProgress?.(0.02, "Rendering");
  await ffmpeg(args, {
    expectedDuration: outDur,
    onProgress: (f) => opts.onProgress?.(0.02 + f * 0.96, "Rendering"),
  });
  return { file: relPath(outPath), durationSec: outDur };
}
