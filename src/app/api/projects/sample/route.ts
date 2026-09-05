import { getCurrentUser } from "@/lib/auth";
import { createProject, saveProject } from "@/lib/db/repo";
import { json, serverError } from "@/lib/http";
import { generateScripts } from "@/lib/scripting/generate";
import type { Angle } from "@/lib/types";

// Creates a ready-to-explore sample project (idea + angle + three scripts) so
// a new user can open the real Scripting / Shooting workspaces immediately.
const SAMPLES: Record<string, { idea: string; reference: string; custom: string }> = {
  default: {
    idea: "The one productivity habit everyone recommends that quietly wastes your time",
    reference: "",
    custom: "why the boring alternative wins",
  },
  tech: { idea: "GPT-6 just launched and everyone is wrong about it", reference: "https://x.com/openai/status/1", custom: "why this matters less than the model nobody is talking about" },
  fitness: { idea: "Why your 5am workout is sabotaging your progress", reference: "", custom: "sleep beats discipline" },
  finance: { idea: "The 50/30/20 budgeting rule is broken in 2026", reference: "", custom: "what actually works when rent is half your income" },
  politics: { idea: "Why the loudest debate this week is a distraction from the vote that matters", reference: "", custom: "follow the money, not the noise" },
  business: { idea: "Most startups die from the first hire, not the last dollar", reference: "", custom: "hire slower than feels comfortable" },
  marketing: { idea: "Hooks are overrated. Here's what actually makes people finish a video", reference: "", custom: "retention beats attention" },
};

export async function POST() {
  const user = await getCurrentUser();
  const sample = SAMPLES[user.niche || ""] || SAMPLES.default;
  try {
    const project = createProject(user.id, { idea: sample.idea, reference: sample.reference || null });
    const angle: Angle = { take: "contrarian", tone: "skeptical", audience: "insiders", length: 30, custom: sample.custom };
    const variants = await generateScripts(project, user, angle, 1);
    project.angle = angle;
    project.scripts = variants;
    project.stage = "scripting";
    saveProject(project);
    return json({ project }, { status: 201 });
  } catch (err) {
    return serverError(err);
  }
}
