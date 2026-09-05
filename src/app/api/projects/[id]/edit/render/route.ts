import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject, updateProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import { startJob } from "@/lib/jobs";
import { renderProject } from "@/lib/editing/pipeline";
import type { AspectId, FormatId } from "@/lib/types";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/render">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  if (!project.edit.sourceFile || project.edit.analysis?.status !== "done") return badRequest("Run the cleanup pass first.");
  if (project.edit.render?.status === "running") return json({ job: { id: project.edit.render.jobId } });
  const body = await readJson<{ format?: FormatId; aspect?: AspectId }>(req);
  if (body.format) project.edit.format = body.format;
  if (body.aspect) project.edit.aspect = body.aspect;
  const job = startJob(
    "render",
    id,
    async (jobCtx) => renderProject(id, user, jobCtx),
    {
      onError: (err) =>
        updateProject(id, (p) => {
          p.edit.render = { status: "failed", error: err.message };
        }),
    },
  );
  project.edit.render = { status: "running", jobId: job.id, format: project.edit.format, aspect: project.edit.aspect };
  saveProject(project);
  return json({ job, project }, { status: 202 });
}
