import fs from "node:fs";
import { absPath } from "@/lib/storage";
import type { CaptionWord, EditState, Project, User } from "@/lib/types";
import { frameSize } from "../captions";
import type { RemotionRenderInput } from "./renderer";
import { DEFAULT_BRAND } from "../../../../remotion/props";

/** Resolve key phrases (strings) to spoken times on the output timeline. */
export function resolveKeyPhrases(captions: CaptionWord[], phrases: string[]): Array<{ text: string; start: number; end: number }> {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const tokens = captions.map((w) => norm(w.text));
  const used = new Set<number>();
  const out: Array<{ text: string; start: number; end: number }> = [];
  for (const phrase of phrases) {
    const p = phrase.split(/\s+/).map(norm).filter(Boolean);
    if (!p.length) continue;
    for (let i = 0; i + p.length <= tokens.length; i++) {
      if (used.has(i)) continue;
      let ok = true;
      for (let k = 0; k < p.length; k++) if (tokens[i + k] !== p[k]) { ok = false; break; }
      if (!ok) continue;
      const start = captions[i].start;
      const end = Math.max(captions[i + p.length - 1].end + 0.6, start + 1.2);
      for (let k = 0; k < p.length; k++) used.add(i + k);
      out.push({ text: phrase, start, end });
      break;
    }
  }
  // avoid overlapping titles
  out.sort((a, b) => a.start - b.start);
  for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].end) out[i - 1].end = Math.max(out[i - 1].start + 0.6, out[i].start - 0.1);
  return out;
}

export function buildRemotionProps(project: Project, user: User): RemotionRenderInput["props"] {
  const edit: EditState = project.edit;
  const brief = edit.brief;
  const { w, h } = frameSize(edit.aspect);
  const captions = edit.captions || [];
  const duration = edit.cleanDuration || (captions.length ? captions[captions.length - 1].end + 0.3 : 1);
  const format = edit.format === "videouse" ? "captions" : edit.format;
  const visuals = edit.visuals
    .filter((v) => v.file && fs.existsSync(absPath(v.file)) && v.end > v.start)
    .map((v, i, arr) => ({ file: absPath(v.file!), start: v.start, end: i === arr.length - 1 ? Math.max(v.end, duration) : v.end, concept: v.concept }));
  const lowerThirdOn = brief?.lowerThird ?? (format === "motion" || format === "captions");
  return {
    template: format,
    durationSec: duration,
    fps: 30,
    width: w,
    height: h,
    facePosition: edit.facePosition || "bottom",
    faceFocusY: 0.3,
    captions,
    captionStyle: edit.captionStyle,
    visuals,
    keyPhrases: resolveKeyPhrases(captions, edit.keyPhrases || []),
    cutPoints: edit.cutPoints || [],
    lowerThird: lowerThirdOn
      ? { name: user.handle ? `@${user.handle.replace(/^@/, "")}` : user.name, subtitle: user.niche ? `${user.niche[0].toUpperCase()}${user.niche.slice(1)} creator` : "Creator", start: 0.8, end: Math.min(5.5, Math.max(2.5, duration - 0.5)) }
      : null,
    effects: {
      punchIn: brief?.punchIn ?? true,
      broll: (brief?.broll ?? true) && (format === "split" || format === "overlay"),
      titles: brief?.titles ?? format === "motion",
      progressBar: format === "motion",
      kenBurns: true,
    },
    brand: DEFAULT_BRAND,
  };
}
