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
import { takeCompletedUpload } from "@/lib/uploads";

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
  const uploadId = form.get("uploadId");
  if (!(file instanceof File) && typeof uploadId !== "string") return badRequest("Missing video file");
  const source = form.get("source") === "uploaded" ? "uploaded" : "recorded";
  const dir = projectDir(id, "takes");
  const takeId = newId("t");
  let originalPath: string;
  let fileName: string;
  if (typeof uploadId === "string") {
    // Chunked upload already assembled on disk; move it into the project.
    let done: ReturnType<typeof takeCompletedUpload>;
    try {
      done = takeCompletedUpload(uploadId);
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : String(err));
    }
    fileName = done.name;
    const ext = (path.extname(done.name) || (done.type.includes("mp4") ? ".mp4" : ".webm")).toLowerCase();
    originalPath = path.join(dir, `${takeId}-original${ext}`);
    fs.renameSync(done.path, originalPath);
  } else {
    const f = file as File;
    fileName = f.name;
    const ext = (path.extname(f.name || "") || (f.type.includes("mp4") ? ".mp4" : ".webm")).toLowerCase();
    originalPath = path.join(dir, `${takeId}-original${ext}`);
    fs.writeFileSync(originalPath, Buffer.from(await f.arrayBuffer()));
  }
  void fileName;
  const finalPath = path.join(dir, `${takeId}.mp4`);

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
