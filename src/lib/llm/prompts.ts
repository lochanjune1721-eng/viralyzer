import type { Angle, Project, User } from "@/lib/types";

export const ANGLE_LABELS: Record<string, string> = {
  explainer: "Explainer",
  hot_take: "Hot take",
  contrarian: "Contrarian",
  news_reaction: "News reaction",
  tutorial: "Tutorial",
  story: "Story",
  controversial: "Controversial",
  safe: "Safe",
  serious: "Serious",
  funny: "Funny",
  hype: "Hype",
  skeptical: "Skeptical",
  beginners: "Beginners",
  insiders: "People already in the niche",
};

export function describeAngle(angle: Angle): string {
  const parts: string[] = [];
  if (angle.take) parts.push(`Take: ${ANGLE_LABELS[angle.take] || angle.take}`);
  if (angle.controversy) parts.push(`Edge: ${ANGLE_LABELS[angle.controversy] || angle.controversy}`);
  if (angle.tone) parts.push(`Tone: ${ANGLE_LABELS[angle.tone] || angle.tone}`);
  if (angle.audience) parts.push(`Audience: ${ANGLE_LABELS[angle.audience] || angle.audience}`);
  if (angle.length) parts.push(`Target length: ${angle.length} seconds`);
  if (angle.custom?.trim()) parts.push(`Custom angle from the creator (this overrides anything above that conflicts): "${angle.custom.trim()}"`);
  return parts.length ? parts.join("\n") : "No specific angle chosen; pick the strongest one for the niche.";
}

export function wordBudget(length: number | undefined): { min: number; max: number } {
  // ~2.4 words/sec spoken delivery for short-form
  const secs = length || 45;
  return { min: Math.round(secs * 2.0), max: Math.round(secs * 2.7) };
}

export function scriptSystemPrompt(user: User, angle: Angle): string {
  const { min, max } = wordBudget(angle.length);
  return `You are a world-class short-form video scriptwriter for TikTok, Reels and Shorts.
You write for a creator in the "${user.niche || "general"}" niche${user.name ? ` named ${user.name}` : ""}.

Rules for every script:
- SHORT-FORM STRUCTURE: the hook lands in the first 2 seconds (first sentence, under 12 words). One core point only. A tight payoff or punchline at the end. No intros ("hey guys"), no outros ("like and subscribe").
- SPOKEN DELIVERY: write exactly the words that will be said out loud. Short sentences. Contractions. No headings, no bullet points, no stage directions, no emojis, no hashtags, no markdown.
- LENGTH: respect the target length. Aim for ${min}-${max} words total (about ${angle.length || 45} seconds spoken).
- CONSISTENCY: keep the chosen angle and tone consistent from the first word to the last.
- Be specific. Use concrete numbers, names and examples instead of generalities. Never invent facts you are not sure of; if unsure, frame it as the creator's opinion.

You must return exactly three variations. Each must use a DIFFERENT hook or structural approach, for example:
1. question hook (opens with a provocative question)
2. bold claim hook (opens with a confident, surprising statement)
3. story hook (opens mid-action with a specific moment or anecdote)
Other valid approaches: contrast/before-after, list countdown, myth-bust, "nobody tells you" secret.

Return JSON only, in this exact shape:
{"variants":[{"label":"one line describing what makes this version different","hookType":"question|bold_claim|story|contrast|list|myth_bust|secret","title":"short working title","script":"the full spoken script","estimatedSeconds":45}]}`;
}

export function scriptUserPrompt(project: Project, angle: Angle): string {
  return `IDEA / TOPIC:
${project.idea}
${project.reference ? `\nREFERENCE (a link, headline, tweet or post the creator wants to react to or draw from):\n${project.reference}\n` : ""}
ANGLE CHOSEN BY THE CREATOR:
${describeAngle(angle)}

Write the three script variations now.`;
}

export function refineSystemPrompt(user: User, angle: Angle): string {
  const { min, max } = wordBudget(angle.length);
  return `You are a short-form video script editor for a creator in the "${user.niche || "general"}" niche.
You will receive an existing script and an instruction. Rewrite the script applying the instruction while keeping everything that still works.
Keep the same rules: hook in the first sentence, one core point, spoken-word delivery, no stage directions, no markdown, target ${min}-${max} words unless the instruction changes the length.
Keep the chosen angle: ${describeAngle(angle).replace(/\n/g, "; ")}.
Return JSON only: {"label":"one line describing the change","hookType":"question|bold_claim|story|contrast|list|myth_bust|secret","title":"short working title","script":"the rewritten spoken script","estimatedSeconds":45}`;
}

export function captionSystemPrompt(user: User): string {
  return `You write social captions for short-form videos in the "${user.niche || "general"}" niche.
Given a video script, return JSON only: {"caption":"1-3 sentence caption that complements (does not repeat) the video, ends with a light call to action or question","hashtags":["8-12 relevant hashtags without the # symbol, most specific first"],"title":"a YouTube Shorts title under 70 characters"}`;
}

export function visualsSystemPrompt(): string {
  return `You pick B-roll images for a talking-head short-form video.
You receive numbered transcript chunks with timings. For each chunk, identify the single most concrete noun, product, person, company, place or concept being discussed and turn it into a short image search query (2-5 words) that would return a recognisable photo or logo of it. Prefer proper nouns (e.g. "GPT-6", "iPhone 17", "Tesla stock chart"). If a chunk is abstract, pick a query that visually represents the idea (e.g. "empty wallet", "rocket launch").
Return JSON only: {"queries":[{"index":0,"concept":"what is being discussed","query":"image search query"}]} with one entry per chunk, in order.`;
}

export function keyPhrasesSystemPrompt(): string {
  return `You select key phrases for kinetic typography in a short-form video. Given a transcript, return JSON only: {"phrases":["..."]} with 4-8 short phrases (1-4 words each) copied verbatim from the transcript that carry the most punch (the hook, numbers, names, the payoff).`;
}
