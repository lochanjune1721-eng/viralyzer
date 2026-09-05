import { chatJson, llmAvailable } from "@/lib/llm/client";
import type { Edl, EdlRange, Project, User, VideoUseMessage } from "@/lib/types";
import { edlDuration, edlFromCuts, packPhrases, packedMarkdown, sanitizeEdl } from "./index";

// The conversational editor: the LLM reads the packed transcript (never the
// frames), proposes a strategy in plain English, and returns an EDL that the
// creator confirms before anything is rendered. Rules distilled from
// vendor/video-use/SKILL.md.

export interface PlanResult {
  reply: string;
  strategy: string | null;
  edl: Edl | null;
  needsConfirmation: boolean;
}

function systemPrompt(user: User): string {
  return `You are a senior short-form video editor working inside the video-use editing engine. You never watch frames; you reason from a word-timed transcript and cut at word boundaries.

You are editing a talking-head video for a creator in the "${user.niche || "general"}" niche. Follow these hard rules:
1. Never cut inside a word: every range start/end must come from the phrase timings you are given (the engine snaps and pads them by 50-80ms).
2. Audio first: prefer cutting at silences >= 0.4s; keep punchlines, laughs and emphasis beats; extend past a payoff so the reaction stays in.
3. Keep the best take of any repeated line and drop the others, drop fillers, false starts, off-script restarts and dead air.
4. Ask -> confirm -> execute: when the creator asks for an edit, describe the plan in plain English in 3-6 sentences and return the EDL, and set needs_confirmation to true. When the creator confirms or just tweaks numbers, return the updated EDL with needs_confirmation false.
5. Respect a requested target length (drop whole beats or trim tails rather than clipping mid-sentence) and report the resulting runtime.
6. Grades: "auto" (clean, no look), "subtle", "neutral_punch", "warm_cinematic" (retro teal/orange), "none", or a raw ffmpeg filter string. Subtitles: "bold-overlay" (2-word UPPERCASE chunks) or "none".
7. Be specific and brief. No markdown headings. Quote the transcript when explaining a cut.

Return JSON only:
{"reply":"what you say to the creator","strategy":"one paragraph plan or null","needs_confirmation":true|false,"edl":{"ranges":[{"start":2.42,"end":6.85,"beat":"HOOK","quote":"...","reason":"..."}],"grade":"auto","subtitles":"bold-overlay"}|null}
Use null for edl when you only need to ask a question.`;
}

export async function planEdit(project: Project, user: User, history: VideoUseMessage[], message: string): Promise<PlanResult> {
  const words = project.edit.transcript?.words || [];
  const current = project.edit.videouse?.edl || edlFromCuts(project);
  const duration = project.edit.sourceDuration || 0;

  if (!llmAvailable()) return heuristicPlan(project, current, message);

  const packed = packedMarkdown("main", words);
  const currentEdl = current.ranges.map((r) => `  [${r.start.toFixed(2)}-${r.end.toFixed(2)}] ${r.beat || ""} ${r.quote ? `"${r.quote}"` : ""}`).join("\n");
  const script = project.finalScript ? `\nSCRIPT THE CREATOR READ FROM:\n${project.finalScript}\n` : "";
  const context = `SOURCE: one file "main", ${duration.toFixed(1)}s long, aspect ${project.edit.aspect}.
${script}
PACKED TRANSCRIPT (phrase-level, [start-end] in seconds):
${packed}

CURRENT EDL (${edlDuration(current).toFixed(1)}s, grade ${current.grade}, subtitles ${current.subtitles}):
${currentEdl || "  (empty)"}`;

  const messages = [
    { role: "system" as const, content: systemPrompt(user) },
    { role: "user" as const, content: context },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.role === "assistant" && m.edl ? `${m.content}\n[EDL proposed: ${m.edl.ranges.length} ranges, ${edlDuration(m.edl).toFixed(1)}s]` : m.content })),
    { role: "user" as const, content: message },
  ];
  const data = await chatJson<{ reply?: string; strategy?: string | null; needs_confirmation?: boolean; edl?: { ranges?: EdlRange[]; grade?: string; subtitles?: string } | null }>(messages, { temperature: 0.4, maxTokens: 3000 });
  const edl = data.edl && Array.isArray(data.edl.ranges) && data.edl.ranges.length
    ? sanitizeEdl({ version: 1, sources: { main: "main" }, ranges: data.edl.ranges, grade: data.edl.grade || current.grade, subtitles: (data.edl.subtitles as Edl["subtitles"]) || current.subtitles, total_duration_s: 0 }, project)
    : null;
  return {
    reply: (data.reply || "").trim() || (edl ? `Proposed an edit with ${edl.ranges.length} segments (${edlDuration(edl).toFixed(1)}s).` : "Tell me more about what you want."),
    strategy: data.strategy?.trim() || null,
    edl,
    needsConfirmation: data.needs_confirmation !== false && !!edl,
  };
}

// ---------- No-key fallback: understands the common asks ----------

function heuristicPlan(project: Project, current: Edl, message: string): PlanResult {
  const lower = message.toLowerCase();
  const words = project.edit.transcript?.words || [];
  let edl: Edl = JSON.parse(JSON.stringify(current)) as Edl;
  const notes: string[] = [];

  const secs = /(\d+)\s*(?:s|sec|seconds)\b/.exec(lower) || /under\s+(\d+)/.exec(lower) || /to\s+(\d+)\b/.exec(lower);
  if (secs && /(short|cut|trim|under|down|length|long)/.test(lower)) {
    const target = Number(secs[1]);
    const phrases = packPhrases(words);
    const kept: EdlRange[] = [];
    let total = 0;
    for (const r of edl.ranges) {
      const inside = phrases.filter((p) => p.start >= r.start - 0.1 && p.end <= r.end + 0.1);
      const pieces = inside.length ? inside : [{ start: r.start, end: r.end, text: r.quote || "" }];
      for (const p of pieces) {
        const len = p.end - p.start;
        if (total + len <= target) {
          kept.push({ source: "main", start: p.start, end: p.end, beat: r.beat, quote: p.text.slice(0, 120), reason: `Fits the ${target}s target` });
          total += len;
          continue;
        }
        // The phrase is longer than what is left: keep whole words up to the budget.
        const budget = target - total;
        const inPhrase = words.filter((w) => w.start >= p.start - 0.05 && w.end <= p.end + 0.05);
        const lastWord = inPhrase.filter((w) => w.end - p.start <= budget).pop();
        if (lastWord && lastWord.end - p.start >= 1) {
          kept.push({ source: "main", start: p.start, end: lastWord.end, beat: r.beat, quote: inPhrase.filter((w) => w.end <= lastWord.end).map((w) => w.text).join(" ").slice(0, 120), reason: `Trimmed at a word boundary to fit ${target}s` });
          total += lastWord.end - p.start;
        }
        break;
      }
      if (total >= target - 0.5) break;
    }
    edl.ranges = kept;
    notes.push(`Trimmed to the first ${total.toFixed(1)}s of clean speech to fit ${target}s, cutting whole phrases only.`);
  }
  if (/warm|cinematic|film/.test(lower)) {
    edl.grade = "warm_cinematic";
    notes.push("Applied the warm cinematic grade.");
  } else if (/punch|contrast|pop/.test(lower)) {
    edl.grade = "neutral_punch";
    notes.push("Applied the neutral punch grade.");
  } else if (/no grade|ungraded|remove (the )?grade|natural colou?r/.test(lower)) {
    edl.grade = "none";
    notes.push("Removed the colour grade.");
  }
  if (/no (sub|caption)|without (sub|caption)|remove (the )?(sub|caption)/.test(lower)) {
    edl.subtitles = "none";
    notes.push("Subtitles off.");
  } else if (/(add|with|burn).*(sub|caption)/.test(lower)) {
    edl.subtitles = "bold-overlay";
    notes.push("Bold 2-word uppercase subtitles on.");
  }
  if (/reset|start over|undo everything|auto cleanup/.test(lower)) {
    edl = edlFromCuts(project);
    notes.push("Reset to the automatic cleanup pass.");
  }
  const remove = /(remove|drop|cut)\s+(?:the\s+)?(?:part|bit|section|segment)\s+(?:about|where|on)\s+(.+)/.exec(lower);
  if (remove) {
    const needle = remove[2].replace(/[.!?]$/, "").trim();
    const before = edl.ranges.length;
    edl.ranges = edl.ranges.filter((r) => !(r.quote || "").toLowerCase().includes(needle));
    notes.push(before === edl.ranges.length ? `Could not find a segment mentioning "${needle}".` : `Dropped ${before - edl.ranges.length} segment(s) mentioning "${needle}".`);
  }

  edl = sanitizeEdl(edl, project);
  if (!notes.length) {
    return {
      reply:
        "Without a DEEPSEEK_API_KEY I can only follow direct instructions: \"cut it down to 45 seconds\", \"warm cinematic grade\", \"no subtitles\", \"drop the part about X\", or \"reset\". Set the key for a real conversation about the edit.",
      strategy: null,
      edl: null,
      needsConfirmation: false,
    };
  }
  return { reply: `${notes.join(" ")} New runtime: ${edlDuration(edl).toFixed(1)}s. Apply it?`, strategy: null, edl, needsConfirmation: true };
}
