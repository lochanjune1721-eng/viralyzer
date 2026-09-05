import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import { captionsForEdl, edlFromCuts, sanitizeEdl } from "@/lib/videouse";
import type { Edl } from "@/lib/types";

// GET: current (or starting) EDL. PATCH: apply a proposed EDL / edit ranges / grade / subtitles / reset.
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/edit/videouse/edl">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const edl = project.edit.videouse?.edl || (project.edit.analysis?.status === "done" ? edlFromCuts(project) : null);
  return json({ edl, videouse: project.edit.videouse || null });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/videouse/edl">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  if (project.edit.analysis?.status !== "done") return badRequest("Run the cleanup pass first.");
  const body = await readJson<{ edl?: Edl; messageId?: string; grade?: string; subtitles?: "bold-overlay" | "none"; reset?: boolean }>(req);
  const state = project.edit.videouse || { messages: [], edl: null, grade: "auto", subtitleStyle: "bold-overlay" as const };
  project.edit.videouse = state;
  let edl = state.edl || edlFromCuts(project);
  if (body.reset) edl = edlFromCuts(project);
  if (body.edl) edl = body.edl;
  if (typeof body.grade === "string") edl = { ...edl, grade: body.grade.trim() || "auto" };
  if (body.subtitles) edl = { ...edl, subtitles: body.subtitles };
  edl = sanitizeEdl(edl, project);
  if (!edl.ranges.length) return badRequest("An edit needs at least one segment.");
  state.edl = edl;
  state.grade = edl.grade;
  state.subtitleStyle = edl.subtitles;
  if (body.messageId) {
    const m = state.messages.find((x) => x.id === body.messageId);
    if (m) m.applied = true;
  }
  state.render = { status: "idle" };
  // keep our own caption editor in sync with the confirmed edit
  project.edit.captions = captionsForEdl(edl, project.edit.transcript?.words || []);
  saveProject(project);
  return json({ edl, videouse: state, project });
}
