// Shared domain types. A Project flows through the five stages; each stage
// reads/writes its own slice of the project so stages stay decoupled.

export const STAGES = ["ideation", "scripting", "shooting", "editing", "uploading"] as const;
export type Stage = (typeof STAGES)[number];
export type ProjectStatus = Stage | "published";

export const NICHES = [
  "tech",
  "fitness",
  "finance",
  "business",
  "marketing",
  "gaming",
  "food",
  "travel",
  "beauty",
  "education",
  "comedy",
  "lifestyle",
  "news",
  "science",
  "crypto",
  "other",
] as const;

export interface User {
  id: string;
  name: string;
  handle: string | null;
  niche: string | null;
  createdAt: string;
}

// ---------- Scripting ----------
export type Take = "explainer" | "hot_take" | "contrarian" | "news_reaction" | "tutorial" | "story";
export type Tone = "serious" | "funny" | "hype" | "skeptical";
export type Audience = "beginners" | "insiders";
export type TargetLength = 15 | 30 | 60 | 90;

export interface Angle {
  take?: Take;
  controversy?: "controversial" | "safe";
  tone?: Tone;
  audience?: Audience;
  length?: TargetLength;
  custom?: string;
}

export interface ScriptVariant {
  id: string;
  label: string; // one-liner describing what makes this variation different
  hookType: string; // question | bold_claim | story | ...
  title: string;
  text: string;
  estimatedSeconds: number;
  createdAt: string;
  generation: number; // which generation round produced it
  parentId?: string; // for refinements
  refineInstruction?: string;
  provider?: string;
}

// ---------- Shooting ----------
export interface TakeRecording {
  id: string;
  name: string;
  file: string; // storage-relative path to the normalized mp4
  originalFile?: string;
  status: "processing" | "ready" | "failed";
  error?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  primary: boolean;
  selected: boolean; // included when sending to editing
  source: "recorded" | "uploaded";
  createdAt: string;
}

// ---------- Editing ----------
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface Transcript {
  words: TranscriptWord[];
  text: string;
  provider: string;
  language?: string;
}

export type CutReason = "retake" | "false_start" | "filler" | "pause" | "lead" | "tail";

export interface EditCut {
  id: string;
  start: number;
  end: number;
  reason: CutReason;
  enabled: boolean;
  detail?: string; // human-readable explanation (e.g. the repeated line)
  groupId?: string; // retake group
}

export interface Visual {
  id: string;
  start: number; // in OUTPUT (post-cut) time
  end: number;
  query: string;
  concept: string;
  imageUrl: string | null; // remote URL
  file: string | null; // storage-relative local copy
  source?: string;
  credit?: string;
}

export interface CaptionWord {
  text: string;
  start: number; // OUTPUT time
  end: number;
}

export type CaptionStyleId = "bold" | "boxed" | "minimal" | "neon";
export type FormatId = "split" | "overlay" | "captions" | "motion";
export type AspectId = "9:16" | "1:1" | "16:9";

export interface EditState {
  sourceFile?: string; // storage-relative path of the concatenated, normalized source
  sourceDuration?: number;
  transcript?: Transcript;
  cuts: EditCut[];
  visuals: Visual[];
  captions?: CaptionWord[]; // editable caption words (post-cut timing)
  captionStyle: CaptionStyleId;
  format: FormatId;
  aspect: AspectId;
  keyPhrases?: string[]; // for motion design
  analysis?: {
    status: "idle" | "running" | "done" | "failed";
    jobId?: string;
    error?: string;
    stats?: { retakes: number; fillers: number; pauses: number; removedSec: number };
  };
  render?: {
    status: "idle" | "running" | "done" | "failed";
    jobId?: string;
    file?: string;
    format?: FormatId;
    aspect?: AspectId;
    error?: string;
    durationSec?: number;
  };
}

// ---------- Uploading ----------
export const PLATFORMS = ["tiktok", "instagram", "youtube", "x", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PublishState {
  caption?: string;
  hashtags?: string[];
  title?: string;
  selected?: Platform[];
  scheduledAt?: string | null;
}

export interface Publication {
  id: string;
  projectId: string;
  platform: Platform;
  status: "scheduled" | "publishing" | "published" | "failed";
  postUrl: string | null;
  postId: string | null;
  error: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Connection {
  id: string;
  userId: string;
  platform: Platform;
  accountName: string | null;
  accountId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ---------- Project ----------
export interface Project {
  id: string;
  userId: string;
  title: string;
  idea: string;
  reference: string | null;
  stage: ProjectStatus;
  angle: Angle;
  scripts: ScriptVariant[];
  selectedScriptId: string | null;
  finalScript: string | null; // text attached when moving to Shooting
  takes: TakeRecording[];
  edit: EditState;
  publish: PublishState;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  projectId: string | null;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number; // 0..1
  message: string | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function defaultEditState(): EditState {
  return { cuts: [], visuals: [], captionStyle: "bold", format: "split", aspect: "9:16" };
}

export const STAGE_ORDER: Record<ProjectStatus, number> = {
  ideation: 0,
  scripting: 1,
  shooting: 2,
  editing: 3,
  uploading: 4,
  published: 5,
};
