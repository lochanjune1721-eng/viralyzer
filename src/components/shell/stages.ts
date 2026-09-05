import { Lightbulb, FileText, Video, Scissors, Send, type LucideIcon } from "lucide-react";
import type { ProjectStatus, Stage } from "@/lib/types";

export interface StageMeta {
  id: Stage;
  label: string;
  icon: LucideIcon;
  blurb: string;
  color: string; // hex, also exposed as --stage-* in globals.css
  emoji: string;
  headline: string;
  features: string[];
}

export const STAGE_META: StageMeta[] = [
  {
    id: "ideation",
    label: "Ideation",
    icon: Lightbulb,
    blurb: "Drop an idea or a reference",
    color: "#f2b544",
    emoji: "💡",
    headline: "Start with a spark",
    features: ["Type a take or paste a link, headline or tweet", "Your niche shapes every script and visual", "One tap moves it into Scripting"],
  },
  {
    id: "scripting",
    label: "Scripting",
    icon: FileText,
    blurb: "Pick an angle, get three scripts",
    color: "#5b8def",
    emoji: "✍️",
    headline: "Three scripts, three hooks",
    features: [
      "Quick angle interview: take, tone, audience, length, or your own custom angle",
      "Exactly three variations with different hooks, side by side",
      "Edit inline or ask for tweaks like \"make it shorter\"; every version stays in history",
    ],
  },
  {
    id: "shooting",
    label: "Shooting",
    icon: Video,
    blurb: "Teleprompter + camera",
    color: "#ef5b8a",
    emoji: "🎥",
    headline: "Teleprompter in your camera",
    features: [
      "Script scrolls right under the lens so eye contact looks natural",
      "Speed, font size, mirror, restart, and voice-paced scrolling",
      "Record as many takes as you like, or upload footage from anywhere",
    ],
  },
  {
    id: "editing",
    label: "Editing",
    icon: Scissors,
    blurb: "Auto cleanup, pick a format",
    color: "#d0704f",
    emoji: "✂️",
    headline: "The edit does itself first",
    features: [
      "Finds repeated lines, keeps your best take, cuts ums, pauses and dead air",
      "Every cut is on a timeline and can be undone with one click",
      "Split screen, overlays, captions-only or motion design, always with word-synced captions",
    ],
  },
  {
    id: "uploading",
    label: "Uploading",
    icon: Send,
    blurb: "Post everywhere at once",
    color: "#8e5bd6",
    emoji: "🚀",
    headline: "One click, every platform",
    features: [
      "Connect TikTok, Reels, Shorts, X and LinkedIn",
      "Caption and hashtags drafted from your script, fully editable",
      "Post now or schedule, with per-platform results and retry",
    ],
  },
];

export const STAGE_COLORS: Record<ProjectStatus, string> = {
  ideation: "bg-[#f2b544]",
  scripting: "bg-[#5b8def]",
  shooting: "bg-[#ef5b8a]",
  editing: "bg-[#d0704f]",
  uploading: "bg-[#8e5bd6]",
  published: "bg-[#2f9e6b]",
};

export const STAGE_HEX: Record<ProjectStatus, string> = {
  ideation: "#f2b544",
  scripting: "#5b8def",
  shooting: "#ef5b8a",
  editing: "#d0704f",
  uploading: "#8e5bd6",
  published: "#2f9e6b",
};

export const STAGE_LABEL: Record<ProjectStatus, string> = {
  ideation: "Ideation",
  scripting: "Scripting",
  shooting: "Shooting",
  editing: "Editing",
  uploading: "Uploading",
  published: "Published",
};

export function stageHref(stage: ProjectStatus, projectId?: string | null): string {
  const s = stage === "published" ? "uploading" : stage;
  if (s === "ideation") return projectId ? `/ideation/${projectId}` : "/";
  return projectId ? `/${s}/${projectId}` : `/${s}`;
}
