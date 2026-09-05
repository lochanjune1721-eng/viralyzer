import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import { recomputeAfterCuts } from "@/lib/editing/pipeline";
import { newId } from "@/lib/ids";
import type { EditCut } from "@/lib/types";

// Toggle (undo/redo) any single cut, add a manual cut, or remove one.
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/cuts">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ cutId?: string; enabled?: boolean; remove?: boolean; add?: { start: number; end: number }; enableAll?: boolean; disableAll?: boolean }>(req);
  const cuts = project.edit.cuts;
  if (body.cutId) {
    const cut = cuts.find((c) => c.id === body.cutId);
    if (!cut) return notFound("Cut not found");
    if (body.remove) project.edit.cuts = cuts.filter((c) => c.id !== body.cutId);
    else if (typeof body.enabled === "boolean") cut.enabled = body.enabled;
  } else if (body.add) {
    const start = Number(body.add.start);
    const end = Number(body.add.end);
    const max = project.edit.sourceDuration || 0;
    if (!(end > start) || start < 0 || end > max + 0.01) return badRequest("Invalid cut range");
    const cut: EditCut = { id: newId("c"), start: +start.toFixed(3), end: +end.toFixed(3), reason: "retake", enabled: true, detail: "Manual cut" };
    project.edit.cuts = [...cuts, cut].sort((a, b) => a.start - b.start);
  } else if (body.enableAll || body.disableAll) {
    for (const c of cuts) c.enabled = !!body.enableAll;
  }
  recomputeAfterCuts(project);
  project.edit.render = { status: "idle" };
  saveProject(project);
  return json({ project });
}
