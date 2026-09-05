import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { json, notFound, readJson, serverError } from "@/lib/http";
import { generateScripts } from "@/lib/scripting/generate";
import type { Angle } from "@/lib/types";

// POST: run the angle interview answers through the LLM and store three variations.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/scripts">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ angle?: Angle }>(req);
  const angle: Angle = { ...project.angle, ...(body.angle || {}) };
  if (angle.length && ![15, 30, 60, 90].includes(Number(angle.length))) angle.length = 60;
  try {
    const generation = (project.scripts.reduce((m, s) => Math.max(m, s.generation), 0) || 0) + 1;
    const variants = await generateScripts(project, user, angle, generation);
    project.angle = angle;
    project.scripts = [...project.scripts, ...variants];
    project.selectedScriptId = null;
    if (project.stage === "ideation") project.stage = "scripting";
    saveProject(project);
    return json({ project, variants });
  } catch (err) {
    return serverError(err);
  }
}
