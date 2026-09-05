import { chatJson, llmAvailable } from "@/lib/llm/client";
import {
  captionSystemPrompt,
  refineSystemPrompt,
  scriptSystemPrompt,
  scriptUserPrompt,
  wordBudget,
} from "@/lib/llm/prompts";
import { newId, nowIso } from "@/lib/ids";
import type { Angle, Project, ScriptVariant, User } from "@/lib/types";

interface RawVariant {
  label?: string;
  hookType?: string;
  title?: string;
  script?: string;
  estimatedSeconds?: number;
}

function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(5, Math.round(words / 2.4));
}

function toVariant(raw: RawVariant, generation: number, provider: string, extra: Partial<ScriptVariant> = {}): ScriptVariant {
  const text = (raw.script || "").trim();
  return {
    id: newId("s"),
    label: (raw.label || "Variation").trim(),
    hookType: (raw.hookType || "custom").trim(),
    title: (raw.title || text.split(/[.!?]/)[0].slice(0, 60)).trim(),
    text,
    estimatedSeconds: Number(raw.estimatedSeconds) || estimateSeconds(text),
    createdAt: nowIso(),
    generation,
    provider,
    ...extra,
  };
}

/** Generate exactly three script variations for a project. */
export async function generateScripts(project: Project, user: User, angle: Angle, generation: number): Promise<ScriptVariant[]> {
  if (!llmAvailable()) {
    return mockVariants(project, user, angle, generation);
  }
  const data = await chatJson<{ variants?: RawVariant[] }>(
    [
      { role: "system", content: scriptSystemPrompt(user, angle) },
      { role: "user", content: scriptUserPrompt(project, angle) },
    ],
    { temperature: 0.9, maxTokens: 3000 },
  );
  let variants = (data.variants || []).filter((v) => v.script && v.script.trim().length > 20).slice(0, 3);
  if (variants.length < 3) {
    // Ask once more for the missing ones rather than failing the whole request.
    const more = await chatJson<{ variants?: RawVariant[] }>(
      [
        { role: "system", content: scriptSystemPrompt(user, angle) },
        {
          role: "user",
          content:
            scriptUserPrompt(project, angle) +
            `\n\nYou previously returned ${variants.length} usable variation(s). Return three NEW variations with different hooks.`,
        },
      ],
      { temperature: 1.0, maxTokens: 3000 },
    );
    variants = [...variants, ...(more.variants || []).filter((v) => v.script && v.script.trim().length > 20)].slice(0, 3);
  }
  if (variants.length === 0) throw new Error("The model did not return any scripts. Try again.");
  return variants.map((v) => toVariant(v, generation, "deepseek"));
}

export async function refineScript(
  base: ScriptVariant,
  instruction: string,
  user: User,
  angle: Angle,
  generation: number,
): Promise<ScriptVariant> {
  if (!llmAvailable()) {
    return mockRefine(base, instruction, generation);
  }
  const raw = await chatJson<RawVariant>(
    [
      { role: "system", content: refineSystemPrompt(user, angle) },
      { role: "user", content: `CURRENT SCRIPT:\n${base.text}\n\nINSTRUCTION:\n${instruction}` },
    ],
    { temperature: 0.7 },
  );
  return toVariant(raw, generation, "deepseek", { parentId: base.id, refineInstruction: instruction });
}

export async function generateCaption(script: string, user: User): Promise<{ caption: string; hashtags: string[]; title: string }> {
  if (!llmAvailable()) {
    const first = script.split(/[.!?]/)[0]?.trim() || "New video";
    const niche = (user.niche || "creator").replace(/\s+/g, "");
    return {
      caption: `${first}. What do you think?`,
      hashtags: [niche, `${niche}tok`, "shorts", "reels", "fyp", "viral", "creator", "tips"],
      title: first.slice(0, 70),
    };
  }
  const data = await chatJson<{ caption?: string; hashtags?: string[]; title?: string }>(
    [
      { role: "system", content: captionSystemPrompt(user) },
      { role: "user", content: `SCRIPT:\n${script}` },
    ],
    { temperature: 0.8 },
  );
  return {
    caption: (data.caption || "").trim(),
    hashtags: (data.hashtags || []).map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 15),
    title: (data.title || "").trim().slice(0, 100),
  };
}

// ---------- Mock mode (no API key) ----------
// Produces structurally valid scripts so the whole pipeline can be exercised
// locally. Output is clearly labelled as mock in the UI.

function mockVariants(project: Project, user: User, angle: Angle, generation: number): ScriptVariant[] {
  const topic = project.idea.replace(/\s+/g, " ").trim();
  const niche = user.niche || "this space";
  const { max } = wordBudget(angle.length);
  const tone = angle.tone || "serious";
  const trimTo = (text: string) => {
    const words = text.split(/\s+/);
    return words.length > max ? words.slice(0, max).join(" ") + "." : text;
  };
  const variants: RawVariant[] = [
    {
      label: "Question hook: opens by challenging what the viewer assumes",
      hookType: "question",
      title: `Is ${topic.slice(0, 40)} overrated?`,
      script: trimTo(
        `What if everything you've heard about ${topic} is only half the story? Here's the part nobody in ${niche} is saying out loud. ${
          angle.take === "contrarian" ? "The hype is real, but it's pointed at the wrong thing." : "The headline isn't the point. The second-order effect is."
        } When this lands, the people who win aren't the ones who move fastest. They're the ones who already know what it changes for them. So before you react, ask one question: what does this actually let me do on Monday that I couldn't do on Friday? If you can answer that, you're ahead of ninety percent of ${niche}. If you can't, save this and come back when you can.`,
      ),
    },
    {
      label: "Bold claim hook: leads with a confident, surprising statement",
      hookType: "bold_claim",
      title: `${topic.slice(0, 40)}: the real story`,
      script: trimTo(
        `${topic} matters less than you think, and I can prove it in thirty seconds. Everyone in ${niche} is staring at the announcement. Almost nobody is looking at what it quietly replaces. That's where the money and the attention are going next. ${
          tone === "funny" ? "It's like watching people queue for a new phone while the app store is where the actual magic happens." : "Think about who benefits when the default changes."
        } The move isn't to argue about whether it's good. The move is to be early to the thing it makes possible. Here's my one-line take: the winners are already building on it. Are you?`,
      ),
    },
    {
      label: "Story hook: starts mid-moment with a specific anecdote",
      hookType: "story",
      title: `The moment ${topic.slice(0, 35)} clicked`,
      script: trimTo(
        `Last week I was in a call and someone said "${topic.slice(0, 50)}" and the whole room went quiet. Not because it was shocking. Because nobody could say what it meant for them. So I spent the weekend figuring it out. Here's the answer. It changes one thing for people in ${niche}: the default. When the default shifts, every workflow built on the old default gets slower and more expensive. That's the whole game. You don't need to be an expert. You need to notice when the default changes before everyone else does. This is one of those moments.`,
      ),
    },
  ];
  return variants.map((v) => toVariant(v, generation, "mock"));
}

function mockRefine(base: ScriptVariant, instruction: string, generation: number): ScriptVariant {
  const lower = instruction.toLowerCase();
  let text = base.text;
  if (/short/.test(lower)) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    text = sentences.slice(0, Math.max(3, Math.ceil(sentences.length * 0.6))).join(" ");
  } else if (/aggressive|punch|stronger/.test(lower)) {
    text = text.replace(/^[^.!?]*[.!?]/, (m) => m.replace(/[.?]$/, "!").toUpperCase().slice(0, 1) + m.slice(1).replace(/[.?]$/, "!"));
  } else if (/long|expand|more detail/.test(lower)) {
    text = text + " And here's the detail most people skip: the timing. Being right early looks exactly like being wrong until it doesn't.";
  } else {
    text = text + ` (${instruction.trim()})`;
  }
  return toVariant(
    { label: `Refined: ${instruction.trim().slice(0, 60)}`, hookType: base.hookType, title: base.title, script: text },
    generation,
    "mock",
    { parentId: base.id, refineInstruction: instruction },
  );
}
