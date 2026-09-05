import fs from "node:fs";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth";
import { createProject, saveProject, updateProject } from "@/lib/db/repo";
import { badRequest, json } from "@/lib/http";
import { videoCapability } from "@/lib/media/capabilities";
import { newId, nowIso } from "@/lib/ids";
import { startJob } from "@/lib/jobs";
import { normalizeVideo, probe } from "@/lib/media/ffmpeg";
import { projectDir, relPath } from "@/lib/storage";
import type { TakeRecording } from "@/lib/types";

// Standalone entry points: bring your own video (and optionally a script)
// straight into Editing, or a finished video straight into Uploading.
// Multipart: file, target=editing|uploading, script?, title?
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const cap = videoCapability();
  if (!cap.ok) return badRequest(cap.reason || "Video processing is unavailable on this server", { videoUnavailable: true });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Missing video file");
  const target = form.get("target") === "uploading" ? "uploading" : "editing";
  const script = String(form.get("script") || "").trim();
  const base = (file.name || "video").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const title = String(form.get("title") || "").trim() || (script ? script.split(/[.!?\n]/)[0].slice(0, 60) : base) || "Imported video";

  const project = createProject(user.id, { idea: script ? script.split(/\n/)[0].slice(0, 200) : `Imported: ${base}`, title });
  if (script) project.finalScript = script;
  const ext = (path.extname(file.name || "") || ".mp4").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (target === "editing") {
    const dir = projectDir(project.id, "takes");
    const takeId = newId("t");
    const originalPath = path.join(dir, `${takeId}-original${ext}`);
    const finalPath = path.join(dir, `${takeId}.mp4`);
    fs.writeFileSync(originalPath, buf);
    const take: TakeRecording = {
      id: takeId,
      name: base || "Upload 1",
      file: relPath(finalPath),
      originalFile: relPath(originalPath),
      status: "processing",
      primary: true,
      selected: true,
      source: "uploaded",
      createdAt: nowIso(),
    };
    project.takes = [take];
    project.stage = "editing";
    project.edit.analysis = { status: "idle" };
    saveProject(project);
    const job = startJob(
      "normalize-take",
      project.id,
      async (ctx) => {
        await normalizeVideo(originalPath, finalPath, { onProgress: (f) => ctx.progress(f, "Preparing video") });
        const info = await probe(finalPath);
        updateProject(project.id, (p) => {
          const t = p.takes.find((x) => x.id === takeId);
          if (t) Object.assign(t, { status: "ready", durationSec: info.duration, width: info.width, height: info.height });
        });
        fs.rmSync(originalPath, { force: true });
        return { takeId };
      },
      {
        onError: (err) =>
          updateProject(project.id, (p) => {
            const t = p.takes.find((x) => x.id === takeId);
            if (t) Object.assign(t, { status: "failed", error: err.message });
          }),
      },
    );
    return json({ project, job }, { status: 201 });
  }

  // target === "uploading": treat the file as the finished render
  const dir = projectDir(project.id, "renders");
  const originalPath = path.join(dir, `import-original${ext}`);
  const finalPath = path.join(dir, `final-import-${Date.now().toString(36)}.mp4`);
  fs.writeFileSync(originalPath, buf);
  project.stage = "uploading";
  const job = startJob(
    "normalize-render",
    project.id,
    async (ctx) => {
      await normalizeVideo(originalPath, finalPath, { onProgress: (f) => ctx.progress(f, "Preparing video") });
      const info = await probe(finalPath);
      const aspect = info.width > info.height ? "16:9" : Math.abs(info.width - info.height) < 8 ? "1:1" : "9:16";
      updateProject(project.id, (p) => {
        p.edit.aspect = aspect;
        p.edit.render = { status: "done", jobId: ctx.id, file: relPath(finalPath), format: p.edit.format, aspect, durationSec: info.duration };
      });
      fs.rmSync(originalPath, { force: true });
      return { file: relPath(finalPath) };
    },
    {
      onError: (err) =>
        updateProject(project.id, (p) => {
          p.edit.render = { status: "failed", error: err.message };
        }),
    },
  );
  project.edit.render = { status: "running", jobId: job.id };
  saveProject(project);
  return json({ project, job }, { status: 201 });
}
