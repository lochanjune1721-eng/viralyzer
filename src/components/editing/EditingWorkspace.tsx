"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Download, Play, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, mediaUrl, pollJob } from "@/lib/api-client";
import { Badge, Button, Card, ProgressBar, Spinner, useToast } from "@/components/ui";
import { useApp, useProject } from "@/components/shell/AppContext";
import { StageHeader } from "@/components/shell/StageHeader";
import type { AspectId, CaptionStyleId, CaptionWord, FormatId, Project } from "@/lib/types";
import { CaptionsEditor } from "./CaptionsEditor";
import { CutsList } from "./CutsList";
import { FormatPicker, FORMATS } from "./FormatPicker";
import { CutPreview } from "./Timeline";
import { VisualsEditor } from "./VisualsEditor";

export function EditingWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { capabilities } = useApp();
  const { project, setProject, reload, error } = useProject(id);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ value: number; message: string | null } | null>(null);
  const [renderProgress, setRenderProgress] = useState<{ value: number; message: string | null } | null>(null);
  const [resourcing, setResourcing] = useState(false);
  const [selectedCut, setSelectedCut] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const autoStarted = useRef(false);

  const edit = project?.edit;
  const analysis = edit?.analysis?.status || "idle";
  const readyTakes = project?.takes.filter((t) => t.status === "ready" && t.selected).length || 0;
  const processingTakes = project?.takes.filter((t) => t.status === "processing").length || 0;

  // Imported footage may still be normalising; poll until it is ready.
  useEffect(() => {
    if (!processingTakes) return;
    const t = setInterval(() => reload(), 2000);
    return () => clearInterval(t);
  }, [processingTakes, reload]);

  const watchJob = useCallback(
    async (jobId: string, setter: typeof setAnalyzeProgress) => {
      setter({ value: 0, message: "Starting" });
      const job = await pollJob(jobId, (j) => setter({ value: j.progress, message: j.message }));
      setter(null);
      await reload();
      if (job.status === "failed") toast.push(job.error || "Job failed", "error");
      return job;
    },
    [reload, toast],
  );

  const runAnalysis = useCallback(async () => {
    try {
      const res = await api<{ job: { id: string }; project: Project }>(`/api/projects/${id}/edit/analyze`, { method: "POST" });
      setProject(res.project);
      await watchJob(res.job.id, setAnalyzeProgress);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }, [id, setProject, toast, watchJob]);

  // Kick off the automatic first pass the first time the project lands here.
  useEffect(() => {
    if (!project || autoStarted.current) return;
    if (analysis === "idle" && readyTakes > 0) {
      autoStarted.current = true;
      runAnalysis();
    } else if (analysis === "running" && edit?.analysis?.jobId) {
      autoStarted.current = true;
      watchJob(edit.analysis.jobId, setAnalyzeProgress);
    }
    if (edit?.render?.status === "running" && edit.render.jobId) watchJob(edit.render.jobId, setRenderProgress);
  }, [project, analysis, readyTakes, edit, runAnalysis, watchJob]);

  const outputDuration = useMemo(() => {
    const caps = edit?.captions || [];
    return caps.length ? caps[caps.length - 1].end : 0;
  }, [edit?.captions]);

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!project || !edit) return <div className="flex justify-center p-12"><Spinner /></div>;

  async function toggleCut(cutId: string, enabled: boolean) {
    // optimistic
    setProject({ ...project!, edit: { ...edit!, cuts: edit!.cuts.map((c) => (c.id === cutId ? { ...c, enabled } : c)) } });
    try {
      const res = await api<{ project: Project }>(`/api/projects/${id}/edit/cuts`, { method: "PATCH", body: { cutId, enabled } });
      setProject(res.project);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      reload();
    }
  }
  async function allCuts(enable: boolean) {
    const res = await api<{ project: Project }>(`/api/projects/${id}/edit/cuts`, { method: "PATCH", body: enable ? { enableAll: true } : { disableAll: true } });
    setProject(res.project);
  }
  async function settings(patch: { format?: FormatId; aspect?: AspectId; captionStyle?: CaptionStyleId; captions?: CaptionWord[]; keyPhrases?: string[] }) {
    try {
      const res = await api<{ project: Project }>(`/api/projects/${id}/edit/settings`, { method: "PATCH", body: patch });
      setProject(res.project);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }
  async function resource() {
    setResourcing(true);
    try {
      const res = await api<{ job: { id: string } }>(`/api/projects/${id}/edit/visuals`, { method: "POST" });
      await pollJob(res.job.id);
      await reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setResourcing(false);
    }
  }
  async function render() {
    try {
      const res = await api<{ job: { id: string }; project: Project }>(`/api/projects/${id}/edit/render`, { method: "POST" });
      setProject(res.project);
      const job = await watchJob(res.job.id, setRenderProgress);
      if (job.status === "done") toast.push("Render finished", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }
  async function publish() {
    setMoving(true);
    try {
      const res = await api<{ project: Project }>(`/api/projects/${id}/stage`, { method: "POST", body: { stage: "uploading" } });
      setProject(res.project);
      router.push(`/uploading/${id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setMoving(false);
    }
  }

  const sourceUrl = mediaUrl(edit.sourceFile);
  const renderUrl = mediaUrl(edit.render?.file);
  const usesVisuals = edit.format === "split" || edit.format === "overlay";
  const stats = edit.analysis?.stats;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-4 md:py-6">
      <StageHeader stage="editing" project={project} />

      {processingTakes > 0 && readyTakes === 0 && (
        <Card className="mb-5 p-5">
          <div className="flex items-center gap-3 text-sm">
            <Spinner /> Preparing your video… the cleanup pass starts automatically when it is ready.
          </div>
        </Card>
      )}
      {readyTakes === 0 && processingTakes === 0 && analysis !== "done" && (
        <Card className="p-6 text-sm text-muted">No takes selected for editing yet. Go back to Shooting, record or upload a take, then send it here.</Card>
      )}

      {(analysis === "running" || analyzeProgress) && (
        <Card className="mb-5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Wand2 className="h-4 w-4 text-accent" /> Automatic cleanup pass
          </div>
          <ProgressBar value={analyzeProgress?.value || 0} label={analyzeProgress?.message || "Working…"} />
          <div className="mt-2 text-xs text-muted">Joining takes → transcribing → finding repeated lines, fillers and pauses → sourcing visuals.</div>
        </Card>
      )}

      {analysis === "failed" && (
        <Card className="mb-5 border-danger/40 p-5">
          <div className="text-sm font-medium text-danger">Cleanup failed</div>
          <div className="mt-1 text-sm text-muted">{edit.analysis?.error}</div>
          <Button className="mt-3" onClick={runAnalysis}>Try again</Button>
        </Card>
      )}

      {analysis === "idle" && readyTakes > 0 && !analyzeProgress && (
        <Card className="mb-5 p-5">
          <Button variant="primary" onClick={runAnalysis}>
            <Wand2 className="h-4 w-4" /> Run cleanup pass
          </Button>
        </Card>
      )}

      {analysis === "done" && sourceUrl && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            {stats && (
              <>
                <Badge tone="danger">{stats.retakes} retakes</Badge>
                <Badge tone="warning">{stats.fillers} fillers</Badge>
                <Badge tone="accent">{stats.pauses} pauses</Badge>
                <Badge>−{stats.removedSec.toFixed(1)}s · final ~{outputDuration.toFixed(0)}s</Badge>
              </>
            )}
            {edit.transcript?.provider === "mock" && <Badge tone="warning">transcript aligned from script (no speech-to-text key)</Badge>}
            <Button size="sm" variant="ghost" onClick={runAnalysis} className="ml-auto">
              <Sparkles className="h-3.5 w-3.5" /> Re-run cleanup
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
            <Card className="p-4">
              <CutPreview src={sourceUrl} duration={edit.sourceDuration || 0} cuts={edit.cuts} onToggle={toggleCut} onSelectCut={setSelectedCut} selectedCutId={selectedCut} />
            </Card>
            <div className="space-y-5">
              <Card className="p-4">
                <CutsList cuts={edit.cuts} selectedCutId={selectedCut} onToggle={toggleCut} onSelect={setSelectedCut} onAll={allCuts} />
              </Card>
              <Card className="p-4">
                <FormatPicker format={edit.format} aspect={edit.aspect} captionStyle={edit.captionStyle} onChange={settings} />
              </Card>
              {usesVisuals && (
                <Card className="p-4">
                  <VisualsEditor project={project} onProject={setProject} onResource={resource} resourcing={resourcing} />
                </Card>
              )}
              <Card className="p-4">
                <CaptionsEditor captions={edit.captions || []} keyPhrases={edit.keyPhrases || []} showKeyPhrases={edit.format === "motion"} onSave={(captions, keyPhrases) => settings({ captions, keyPhrases })} />
              </Card>
            </div>
          </div>

          <Card className="mt-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Export</div>
                <div className="text-xs text-muted">
                  {FORMATS.find((f) => f.id === edit.format)?.name} · {edit.aspect} · {edit.captionStyle} captions · rendered server-side with FFmpeg
                </div>
              </div>
              <Button variant="primary" onClick={render} loading={!!renderProgress || edit.render?.status === "running"}>
                <Play className="h-4 w-4" /> {edit.render?.status === "done" ? "Re-render" : "Render video"}
              </Button>
            </div>
            {renderProgress && <div className="mt-4"><ProgressBar value={renderProgress.value} label={renderProgress.message || "Rendering…"} /></div>}
            {edit.render?.status === "failed" && <div className="mt-3 text-sm text-danger">{edit.render.error}</div>}
            {edit.render?.status === "done" && renderUrl && (
              <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-[220px_1fr]">
                <video src={renderUrl} controls playsInline className="w-full rounded-xl bg-black" />
                <div className="space-y-3 text-sm">
                  <div className="text-muted">
                    Rendered {edit.render.format} · {edit.render.aspect} · {edit.render.durationSec?.toFixed(1)}s
                    {edit.render.format !== edit.format || edit.render.aspect !== edit.aspect ? " · settings changed since, re-render to apply" : ""}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={renderUrl} download className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm hover:bg-surface-2">
                      <Download className="h-4 w-4" /> Download
                    </a>
                    <Button variant="primary" onClick={publish} loading={moving}>
                      Publish <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
          {capabilities?.transcription === "mock" && (
            <div className="mt-3 text-xs text-muted">Tip: set OPENAI_API_KEY, GROQ_API_KEY or DEEPGRAM_API_KEY for real word-level transcription and retake detection.</div>
          )}
        </>
      )}
    </div>
  );
}
