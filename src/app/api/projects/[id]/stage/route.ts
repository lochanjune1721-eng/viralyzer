import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import { STAGES, type Stage } from "@/lib/types";

// Moves a project to a stage. Guards the hand-offs that need data attached:
// shooting needs a chosen script, editing needs a ready take, uploading needs a render.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/stage">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ stage?: Stage; scriptText?: string }>(req);
  const stage = body.stage;
  if (!stage || !STAGES.includes(stage)) return badRequest("Invalid stage");

  if (stage === "shooting") {
    const selected = project.scripts.find((s) => s.id === project.selectedScriptId);
    const text = (body.scriptText ?? selected?.text ?? project.finalScript ?? "").trim();
    if (!text) return badRequest("Pick a script before moving to Shooting.");
    project.finalScript = text;
    if (selected && body.scriptText && body.scriptText.trim() !== selected.text) {
      selected.text = body.scriptText.trim();
    }
  }
  if (stage === "editing") {
    if (!project.takes.some((t) => t.status === "ready")) return badRequest("Record or upload at least one take first.");
    if (!project.takes.some((t) => t.selected && t.status === "ready")) {
      const primary = project.takes.find((t) => t.primary && t.status === "ready") || project.takes.find((t) => t.status === "ready");
      if (primary) primary.selected = true;
    }
    // A new set of takes invalidates the previous analysis.
    project.edit.analysis = { status: "idle" };
  }
  if (stage === "uploading" && !project.edit.render?.file) return badRequest("Export a render before publishing.");
  project.stage = stage;
  saveProject(project);
  return json({ project });
}
