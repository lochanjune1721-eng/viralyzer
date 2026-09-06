import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject, updateProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import { startJob } from "@/lib/jobs";
import { videoCapability } from "@/lib/media/capabilities";
import { autoEditProject } from "@/lib/editing/pipeline";
import { layoutToFormat, type AspectId, type CaptionStyleId, type EditBrief, type LayoutId } from "@/lib/types";

const LAYOUTS: LayoutId[] = ["split-face-bottom", "split-face-top", "overlay", "captions", "motion"];
const STYLES: CaptionStyleId[] = ["bold", "boxed", "minimal", "neon"];
const ASPECTS: AspectId[] = ["9:16", "1:1", "16:9"];

// "What kind of edit do you need?" → one job: prepare, analyze, cut, clean, render.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/auto">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const cap = videoCapability();
  if (!cap.ok) return badRequest(cap.reason || "Video processing is unavailable on this server", { videoUnavailable: true });
  if (!project.takes.length) return badRequest("Upload or record footage first.");
  const body = await readJson<{ brief?: Partial<EditBrief>; script?: string }>(req);
  const b = body.brief || {};
  const brief: EditBrief = {
    layout: LAYOUTS.includes(b.layout as LayoutId) ? (b.layout as LayoutId) : "split-face-bottom",
    captionStyle: STYLES.includes(b.captionStyle as CaptionStyleId) ? (b.captionStyle as CaptionStyleId) : "bold",
    aspect: ASPECTS.includes(b.aspect as AspectId) ? (b.aspect as AspectId) : "9:16",
    removeSilences: b.removeSilences ?? true,
    removeFillers: b.removeFillers ?? true,
    keepBestTakes: b.keepBestTakes ?? true,
    punchIn: b.punchIn ?? true,
    broll: b.broll ?? true,
    titles: b.titles ?? true,
    lowerThird: b.lowerThird ?? true,
    grade: typeof b.grade === "string" && b.grade ? b.grade : "auto",
    targetLength: typeof b.targetLength === "number" && b.targetLength > 0 ? b.targetLength : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 500) : undefined,
  };
  if (project.edit.auto?.status === "running" && project.edit.auto.jobId) return json({ job: { id: project.edit.auto.jobId }, project });
  const { format, facePosition } = layoutToFormat(brief.layout);
  if (typeof body.script === "string" && body.script.trim()) project.finalScript = body.script.trim();
  project.edit.brief = brief;
  project.edit.format = format;
  project.edit.facePosition = facePosition;
  project.edit.captionStyle = brief.captionStyle;
  project.edit.aspect = brief.aspect;
  project.edit.analysis = { status: "idle" };
  project.edit.render = { status: "idle" };
  project.stage = "editing";
  const job = startJob(
    "auto-edit",
    id,
    async (jobCtx) => {
      updateProject(id, (p) => {
        p.edit.analysis = { status: "running", jobId: jobCtx.id };
      });
      return autoEditProject(id, user, jobCtx);
    },
    {
      onError: (err) =>
        updateProject(id, (p) => {
          p.edit.auto = { status: "failed", error: err.message };
          if (p.edit.analysis?.status === "running") p.edit.analysis = { status: "failed", error: err.message };
          if (p.edit.render?.status === "running") p.edit.render = { status: "failed", error: err.message };
        }),
    },
  );
  project.edit.auto = { status: "running", jobId: job.id, stage: "waiting" };
  saveProject(project);
  return json({ job, project }, { status: 202 });
}
