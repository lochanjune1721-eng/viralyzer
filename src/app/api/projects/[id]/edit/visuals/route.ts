import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject, updateProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import { startJob } from "@/lib/jobs";
import { autoSourceVisuals, cacheImage } from "@/lib/editing/visuals";

// POST: re-run auto sourcing (background job). PATCH: replace one image or adjust timing.
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/edit/visuals">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const captions = project.edit.captions || [];
  if (!captions.length) return badRequest("Run the cleanup pass first.");
  const job = startJob("visuals", id, async (jobCtx) => {
    const visuals = await autoSourceVisuals(id, captions, user.niche, (f, m) => jobCtx.progress(f, m));
    updateProject(id, (p) => {
      p.edit.visuals = visuals;
      p.edit.render = { status: "idle" };
    });
    return { count: visuals.length };
  });
  return json({ job }, { status: 202 });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/visuals">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ visualId?: string; imageUrl?: string; query?: string; start?: number; end?: number; remove?: boolean; source?: string; credit?: string }>(req);
  const visual = project.edit.visuals.find((v) => v.id === body.visualId);
  if (!visual) return notFound("Visual not found");
  if (body.remove) {
    visual.file = null;
    visual.imageUrl = null;
  }
  if (body.imageUrl) {
    try {
      visual.file = await cacheImage(id, body.imageUrl);
      visual.imageUrl = body.imageUrl;
      visual.source = body.source || "custom";
      visual.credit = body.credit;
    } catch (err) {
      return badRequest(`Could not fetch that image: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (typeof body.query === "string") visual.query = body.query.trim();
  if (typeof body.start === "number") visual.start = Math.max(0, body.start);
  if (typeof body.end === "number") visual.end = Math.max(visual.start + 0.5, body.end);
  project.edit.render = { status: "idle" };
  saveProject(project);
  return json({ project });
}
