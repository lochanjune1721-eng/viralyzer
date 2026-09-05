import { getCurrentUser } from "@/lib/auth";
import { getProject, listPublications } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson, serverError } from "@/lib/http";
import { platformStatuses, publishProject } from "@/lib/publish";
import { PLATFORMS, type Platform } from "@/lib/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/publish">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  return json({ publications: listPublications(id), platforms: await platformStatuses(user.id), publish: project.publish });
}

// "Post everywhere": publish now or schedule for later on every selected platform.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/publish">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ platforms?: Platform[]; caption?: string; hashtags?: string[]; title?: string; scheduledAt?: string | null }>(req);
  const platforms = (body.platforms || []).filter((p) => PLATFORMS.includes(p));
  if (!platforms.length) return badRequest("Select at least one platform.");
  if (!project.edit.render?.file) return badRequest("Render the video first.");
  if (body.scheduledAt && Number.isNaN(new Date(body.scheduledAt).getTime())) return badRequest("Invalid schedule time");
  try {
    const publications = await publishProject(project, user, {
      platforms,
      caption: (body.caption || "").trim(),
      hashtags: (body.hashtags || []).map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean),
      title: (body.title || project.title).trim(),
      scheduledAt: body.scheduledAt || null,
    });
    return json({ publications, project: getProject(id) });
  } catch (err) {
    return serverError(err);
  }
}
