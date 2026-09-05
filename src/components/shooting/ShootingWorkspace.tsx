"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, pollJob, uploadVideoChunked } from "@/lib/api-client";
import { Button, Card, Spinner, useToast } from "@/components/ui";
import { useProject } from "@/components/shell/AppContext";
import { StageHeader } from "@/components/shell/StageHeader";
import { VideoUnavailableBanner } from "@/components/shell/VideoUnavailableBanner";
import type { Project } from "@/lib/types";
import { TakesList } from "./TakesList";
import { Teleprompter, type RecordingResult } from "./Teleprompter";

export function ShootingWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { project, setProject, reload, error } = useProject(id);
  const [uploading, setUploading] = useState(false);
  const [moving, setMoving] = useState(false);

  const script = project?.finalScript || project?.scripts.find((s) => s.id === project.selectedScriptId)?.text || "";

  // Poll while any take is still being normalised.
  useEffect(() => {
    if (!project?.takes.some((t) => t.status === "processing")) return;
    const t = setInterval(() => reload(), 2000);
    return () => clearInterval(t);
  }, [project, reload]);

  const upload = useCallback(
    async (blob: Blob, filename: string, source: "recorded" | "uploaded") => {
      setUploading(true);
      try {
        const uploadId = await uploadVideoChunked(blob, filename);
        const form = new FormData();
        form.append("uploadId", uploadId);
        form.append("source", source);
        const res = await api<{ take: { id: string }; job: { id: string } }>(`/api/projects/${id}/takes`, { method: "POST", body: form });
        await reload();
        toast.push("Take saved. Processing…", "success");
        pollJob(res.job.id).then(() => reload());
      } catch (err) {
        toast.push(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setUploading(false);
      }
    },
    [id, reload, toast],
  );

  const onRecorded = useCallback((r: RecordingResult) => {
    const ext = r.mimeType.includes("mp4") ? "mp4" : "webm";
    upload(r.blob, `take.${ext}`, "recorded");
  }, [upload]);

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!project) return <div className="flex justify-center p-12"><Spinner /></div>;

  async function patchTake(takeId: string, body: Record<string, unknown>) {
    const res = await api<{ project: Project }>(`/api/projects/${id}/takes/${takeId}`, { method: "PATCH", body });
    setProject(res.project);
  }
  async function deleteTake(takeId: string) {
    if (!confirm("Delete this take?")) return;
    const res = await api<{ project: Project }>(`/api/projects/${id}/takes/${takeId}`, { method: "DELETE" });
    setProject(res.project);
  }
  async function sendToEditing() {
    setMoving(true);
    try {
      const res = await api<{ project: Project }>(`/api/projects/${id}/stage`, { method: "POST", body: { stage: "editing" } });
      setProject(res.project);
      router.push(`/editing/${id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setMoving(false);
    }
  }

  const readyCount = project.takes.filter((t) => t.status === "ready" && t.selected).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 md:px-4 md:py-6">
      <StageHeader
        stage="shooting"
        project={project}
        right={
          <Button variant="primary" onClick={sendToEditing} loading={moving} disabled={readyCount === 0}>
            Send to editing {readyCount > 1 ? `(${readyCount} takes)` : ""} <ArrowRight className="h-4 w-4" />
          </Button>
        }
      />
      <VideoUnavailableBanner />
      {!script ? (
        <Card className="p-6 text-sm text-muted">No script attached yet. Go back to Scripting and pick one.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,440px)_1fr]">
          <div>
            <Teleprompter script={script} onRecorded={onRecorded} uploading={uploading} />
            <div className="mt-2 text-center text-xs text-muted">Read from the top of the frame to keep eye contact with the lens. Works best on a phone in portrait.</div>
          </div>
          <div className="space-y-4">
            <TakesList
              takes={project.takes}
              uploading={uploading}
              onPrimary={(tid) => patchTake(tid, { primary: true })}
              onToggle={(tid, selected) => patchTake(tid, { selected })}
              onDelete={deleteTake}
              onUpload={(file) => upload(file, file.name, "uploaded")}
            />
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted">Script</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{script}</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
