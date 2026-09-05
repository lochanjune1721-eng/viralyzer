import { Lightbulb, FileText, Video, Scissors, Send, type LucideIcon } from "lucide-react";
import type { ProjectStatus, Stage } from "@/lib/types";

export const STAGE_META: Array<{ id: Stage; label: string; icon: LucideIcon; blurb: string }> = [
  { id: "ideation", label: "Ideation", icon: Lightbulb, blurb: "Drop an idea or a reference" },
  { id: "scripting", label: "Scripting", icon: FileText, blurb: "Pick an angle, get three scripts" },
  { id: "shooting", label: "Shooting", icon: Video, blurb: "Teleprompter + camera" },
  { id: "editing", label: "Editing", icon: Scissors, blurb: "Auto cleanup, pick a format" },
  { id: "uploading", label: "Uploading", icon: Send, blurb: "Post everywhere at once" },
];

export const STAGE_COLORS: Record<ProjectStatus, string> = {
  ideation: "bg-[#8a8378]",
  scripting: "bg-[#5b7fd6]",
  shooting: "bg-[#d69a2a]",
  editing: "bg-[#d0704f]",
  uploading: "bg-[#8e5bd6]",
  published: "bg-[#2f9e6b]",
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
