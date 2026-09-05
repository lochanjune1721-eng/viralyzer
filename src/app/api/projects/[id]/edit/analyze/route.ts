import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject, updateProject } from "@/lib/db/repo";
import { videoCapability } from "@/lib/media/capabilities";
import { badRequest, json, notFound } from "@/lib/http";
import { startJob } from "@/lib/jobs";
import { analyzeProject } from "@/lib/editing/pipeline";

// Kicks off the automatic cleanup pass (join takes, transcribe, detect cuts, source visuals).
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/edit/analyze">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const cap = videoCapability();
  if (!cap.ok) return badRequest(cap.reason || "Video processing is unavailable on this server", { videoUnavailable: true });
  if (!project.takes.some((t) => t.status === "ready")) return badRequest("No ready takes to analyze.");
  if (project.edit.analysis?.status === "running") return json({ job: { id: project.edit.analysis.jobId } });

  const job = startJob(
    "analyze",
    id,
    async (jobCtx) => {
      await analyzeProject(id, user, jobCtx);
      return { ok: true };
    },
    {
      onError: (err) =>
        updateProject(id, (p) => {
          p.edit.analysis = { status: "failed", error: err.message };
        }),
    },
  );
  project.edit.analysis = { status: "running", jobId: job.id };
  project.edit.render = { status: "idle" };
  if (project.stage === "shooting") project.stage = "editing";
  saveProject(project);
  return json({ job, project }, { status: 202 });
}
