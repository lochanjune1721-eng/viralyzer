import { getCurrentUser } from "@/lib/auth";
import { getProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson, serverError } from "@/lib/http";
import { runPublications } from "@/lib/publish";
import { PLATFORMS, type Platform } from "@/lib/types";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/publish/retry">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ platform?: Platform }>(req);
  if (!body.platform || !PLATFORMS.includes(body.platform)) return badRequest("Unknown platform");
  try {
    const publications = await runPublications(id, [body.platform]);
    return json({ publications, project: getProject(id) });
  } catch (err) {
    return serverError(err);
  }
}
