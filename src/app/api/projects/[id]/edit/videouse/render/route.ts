import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject, updateProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import { startJob } from "@/lib/jobs";
import { videoCapability } from "@/lib/media/capabilities";
import { edlFromCuts, renderEdl, videoUseCapability } from "@/lib/videouse";

// Render the confirmed EDL through the video-use engine (render.py).
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/videouse/render">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const vc = videoCapability();
  if (!vc.ok) return badRequest(vc.reason || "Video processing unavailable", { videoUnavailable: true });
  const cap = videoUseCapability();
  if (!cap.ok) return badRequest(cap.reason || "video-use engine unavailable");
  if (project.edit.analysis?.status !== "done" || !project.edit.sourceFile) return badRequest("Run the cleanup pass first.");
  const body = await readJson<{ preview?: boolean }>(req);
  const state = project.edit.videouse || { messages: [], edl: null, grade: "auto", subtitleStyle: "bold-overlay" as const };
  project.edit.videouse = state;
  if (!state.edl) state.edl = edlFromCuts(project);
  if (state.render?.status === "running") return json({ job: { id: state.render.jobId } });
  const edl = state.edl;
  const preview = !!body.preview;
  const job = startJob(
    "videouse-render",
    id,
    async (jobCtx) => {
      const result = await renderEdl(project, edl, { preview, onProgress: (f, m) => jobCtx.progress(f, m) });
      updateProject(id, (p) => {
        const s = p.edit.videouse!;
        s.render = { status: "done", jobId: jobCtx.id, file: result.file, preview, durationSec: result.durationSec, log: result.log.slice(-4000) };
        // The video-use output is the project's deliverable so Publish picks it up.
        p.edit.render = { status: "done", jobId: jobCtx.id, file: result.file, format: "videouse", aspect: p.edit.aspect, durationSec: result.durationSec };
      });
      return result;
    },
    {
      onError: (err) =>
        updateProject(id, (p) => {
          p.edit.videouse!.render = { status: "failed", error: err.message };
        }),
    },
  );
  state.render = { status: "running", jobId: job.id, preview };
  saveProject(project);
  return json({ job, videouse: state }, { status: 202 });
}
