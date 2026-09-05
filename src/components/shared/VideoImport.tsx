"use client";

import { useRouter } from "next/navigation";
import { FileVideo, UploadCloud, Wand2 } from "lucide-react";
import { useRef, useState } from "react";
import { api, pollJob, uploadVideoChunked } from "@/lib/api-client";
import { Button, ProgressBar, cx, useToast } from "@/components/ui";
import { useApp } from "@/components/shell/AppContext";
import type { Project } from "@/lib/types";

// Drop a video (and optionally the script it was read from) to start Editing
// or Uploading without going through the earlier stages.
export function VideoImport({ target, accent }: { target: "editing" | "uploading"; accent: string }) {
  const router = useRouter();
  const toast = useToast();
  const { upsertProject, capabilities } = useApp();
  const videoOk = capabilities?.video.ok ?? true;
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [script, setScript] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ value: number; message: string } | null>(null);

  function pick(f: File | undefined | null) {
    if (!f) return;
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)) return toast.push("Please choose a video file.", "error");
    setFile(f);
  }

  async function go() {
    if (!file) return toast.push("Choose a video first.", "error");
    setBusy(true);
    setProgress({ value: 0.02, message: "Uploading video" });
    try {
      const uploadId = await uploadVideoChunked(file, file.name, (f) => setProgress({ value: f * 0.2, message: `Uploading video ${Math.round(f * 100)}%` }));
      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("target", target);
      if (script.trim()) form.append("script", script.trim());
      const res = await api<{ project: Project; job: { id: string } }>("/api/projects/import", { method: "POST", body: form });
      upsertProject(res.project);
      setProgress({ value: 0.2, message: "Preparing video" });
      const job = await pollJob(res.job.id, (j) => setProgress({ value: 0.2 + j.progress * 0.8, message: j.message || "Preparing video" }));
      if (job.status === "failed") throw new Error(job.error || "Could not process that video");
      router.push(`/${target}/${res.project.id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/90 p-4 shadow-lg shadow-black/5 backdrop-blur">
      <div
        className={cx("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors", drag ? "bg-surface-2" : "border-border hover:bg-surface-2")}
        style={{ borderColor: drag || file ? accent : undefined }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <>
            <FileVideo className="h-8 w-8" style={{ color: accent }} />
            <div className="mt-2 text-sm font-medium">{file.name}</div>
            <div className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB · click to change</div>
          </>
        ) : (
          <>
            <UploadCloud className="h-8 w-8 text-muted" />
            <div className="mt-2 text-sm font-medium">{target === "editing" ? "Drop your raw video here" : "Drop your finished video here"}</div>
            <div className="text-xs text-muted">mp4, mov or webm from any camera or phone. Long takes are fine.</div>
          </>
        )}
      </div>
      {target === "editing" && (
        <div className="mt-3">
          <label className="text-xs font-medium text-muted">Paste the script you read (optional, makes retake detection much sharper)</label>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={4}
            placeholder="The script, line by line. Everything you said that is not in here (restarts, mumbles, 'wait, again') gets flagged for cutting."
            className="mt-1 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
      {progress && <div className="mt-3"><ProgressBar value={progress.value} label={progress.message} /></div>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {target === "editing" ? "We transcribe it, keep your best take of every line, cut ums and pauses, then you pick a format." : "Skips editing. Goes straight to captions, hashtags and one-click posting."}
        </div>
        <Button variant="primary" onClick={go} loading={busy} disabled={!file || !videoOk} title={videoOk ? undefined : capabilities?.video.reason || undefined}>
          <Wand2 className="h-4 w-4" /> {target === "editing" ? "Clean it up" : "Prepare to post"}
        </Button>
      </div>
    </div>
  );
}
