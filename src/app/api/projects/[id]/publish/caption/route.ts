import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, serverError } from "@/lib/http";
import { generateCaption } from "@/lib/scripting/generate";

// Pre-fill caption, hashtags and title from the final script.
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/publish/caption">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const script = project.finalScript || project.edit.captions?.map((w) => w.text).join(" ") || "";
  if (!script) return badRequest("No script to write a caption from.");
  try {
    const out = await generateCaption(script, user);
    project.publish = { ...project.publish, caption: out.caption, hashtags: out.hashtags, title: out.title };
    saveProject(project);
    return json({ publish: project.publish });
  } catch (err) {
    return serverError(err);
  }
}
