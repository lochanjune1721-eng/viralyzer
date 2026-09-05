import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";

// Inline edits to a script variation.
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/scripts/[scriptId]">) {
  const user = await getCurrentUser();
  const { id, scriptId } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const script = project.scripts.find((s) => s.id === scriptId);
  if (!script) return notFound("Script not found");
  const body = await readJson<{ text?: string; title?: string }>(req);
  if (typeof body.text === "string") {
    if (!body.text.trim()) return badRequest("Script cannot be empty");
    script.text = body.text;
    script.estimatedSeconds = Math.max(5, Math.round(body.text.trim().split(/\s+/).length / 2.4));
  }
  if (typeof body.title === "string") script.title = body.title.trim().slice(0, 100);
  saveProject(project);
  return json({ project, script });
}
