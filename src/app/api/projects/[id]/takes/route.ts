import fs from "node:fs";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject, updateProject } from "@/lib/db/repo";
import { badRequest, json, notFound } from "@/lib/http";
import { videoCapability } from "@/lib/media/capabilities";
import { newId, nowIso } from "@/lib/ids";
import { startJob } from "@/lib/jobs";
import { normalizeVideo, probe } from "@/lib/media/ffmpeg";
import { projectDir, relPath } from "@/lib/storage";
import type { TakeRecording } from "@/lib/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/takes">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  return json({ takes: project.takes });
}

// Multipart upload of a recorded or external video. The file is normalised to
// mp4 in the background; the take shows as "processing" until that finishes.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/takes">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const cap = videoCapability();
  if (!cap.ok) return badRequest(cap.reason || "Video processing is unavailable on this server", { videoUnavailable: true });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Missing video file");
  const source = form.get("source") === "uploaded" ? "uploaded" : "recorded";
  const dir = projectDir(id, "takes");
  const takeId = newId("t");
  const ext = (path.extname(file.name || "") || (file.type.includes("mp4") ? ".mp4" : ".webm")).toLowerCase();
  const originalPath = path.join(dir, `${takeId}-original${ext}`);
  const finalPath = path.join(dir, `${takeId}.mp4`);
  fs.writeFileSync(originalPath, Buffer.from(await file.arrayBuffer()));

  const count = project.takes.length + 1;
  const take: TakeRecording = {
    id: takeId,
    name: (form.get("name") as string) || (source === "uploaded" ? `Upload ${count}` : `Take ${count}`),
    file: relPath(finalPath),
    originalFile: relPath(originalPath),
    status: "processing",
    primary: project.takes.length === 0,
    selected: true,
    source,
    createdAt: nowIso(),
  };
  project.takes.push(take);
  if (project.stage === "scripting") project.stage = "shooting";
  saveProject(project);

  const job = startJob("normalize-take", id, async (jobCtx) => {
    await normalizeVideo(originalPath, finalPath, { onProgress: (f) => jobCtx.progress(f) });
    const info = await probe(finalPath);
    updateProject(id, (p) => {
      const t = p.takes.find((x) => x.id === takeId);
      if (t) {
        t.status = "ready";
        t.durationSec = info.duration;
        t.width = info.width;
        t.height = info.height;
      }
    });
    fs.rmSync(originalPath, { force: true });
    return { takeId };
  }, {
    onError: (err) =>
      updateProject(id, (p) => {
        const t = p.takes.find((x) => x.id === takeId);
        if (t) {
          t.status = "failed";
          t.error = err.message;
        }
      }),
  });
  return json({ take, job }, { status: 201 });
}
