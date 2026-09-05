import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson, serverError } from "@/lib/http";
import { refineScript } from "@/lib/scripting/generate";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/scripts/refine">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ scriptId?: string; instruction?: string; text?: string }>(req);
  const base = project.scripts.find((s) => s.id === body.scriptId);
  if (!base) return badRequest("Script not found");
  const instruction = (body.instruction || "").trim();
  if (!instruction) return badRequest("Tell me what to change.");
  try {
    const generation = project.scripts.reduce((m, s) => Math.max(m, s.generation), 0) + 1;
    // Refine from the user's current inline edits if they sent them.
    const source = body.text && body.text.trim() ? { ...base, text: body.text.trim() } : base;
    const variant = await refineScript(source, instruction, user, project.angle, generation);
    project.scripts.push(variant);
    project.selectedScriptId = variant.id;
    saveProject(project);
    return json({ project, variant });
  } catch (err) {
    return serverError(err);
  }
}
