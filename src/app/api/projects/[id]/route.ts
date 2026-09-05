import fs from "node:fs";
import { getCurrentUser } from "@/lib/auth";
import { deleteProject, getProject, listPublications, saveProject } from "@/lib/db/repo";
import { json, notFound, readJson } from "@/lib/http";
import { absPath } from "@/lib/storage";
import type { Angle, ProjectStatus } from "@/lib/types";
import { STAGES } from "@/lib/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  return json({ project, publications: listPublications(id) });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{
    title?: string;
    idea?: string;
    reference?: string | null;
    angle?: Angle;
    selectedScriptId?: string | null;
    finalScript?: string | null;
    stage?: ProjectStatus;
  }>(req);
  if (typeof body.title === "string" && body.title.trim()) project.title = body.title.trim().slice(0, 120);
  if (typeof body.idea === "string") project.idea = body.idea.trim();
  if (body.reference !== undefined) project.reference = body.reference ? String(body.reference).trim() : null;
  if (body.angle && typeof body.angle === "object") project.angle = { ...project.angle, ...body.angle };
  if (body.selectedScriptId !== undefined) project.selectedScriptId = body.selectedScriptId;
  if (body.finalScript !== undefined) project.finalScript = body.finalScript;
  if (body.stage && ([...STAGES, "published"] as string[]).includes(body.stage)) project.stage = body.stage;
  saveProject(project);
  return json({ project });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  deleteProject(id);
  try {
    fs.rmSync(absPath(`projects/${id}`), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return json({ ok: true });
}
