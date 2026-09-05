import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { json, notFound, readJson } from "@/lib/http";
import { removeIfExists } from "@/lib/storage";

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/takes/[takeId]">) {
  const user = await getCurrentUser();
  const { id, takeId } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const take = project.takes.find((t) => t.id === takeId);
  if (!take) return notFound("Take not found");
  const body = await readJson<{ primary?: boolean; selected?: boolean; name?: string }>(req);
  if (body.primary) {
    for (const t of project.takes) t.primary = t.id === takeId;
    take.selected = true;
  }
  if (typeof body.selected === "boolean") take.selected = body.selected;
  if (typeof body.name === "string" && body.name.trim()) take.name = body.name.trim().slice(0, 60);
  saveProject(project);
  return json({ project });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/takes/[takeId]">) {
  const user = await getCurrentUser();
  const { id, takeId } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const take = project.takes.find((t) => t.id === takeId);
  if (!take) return notFound("Take not found");
  removeIfExists(take.file);
  removeIfExists(take.originalFile);
  project.takes = project.takes.filter((t) => t.id !== takeId);
  if (take.primary && project.takes.length) project.takes[0].primary = true;
  saveProject(project);
  return json({ project });
}
