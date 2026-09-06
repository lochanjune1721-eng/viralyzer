"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Download, Play, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, mediaUrl, pollJob } from "@/lib/api-client";
import { Badge, Button, Card, ProgressBar, Spinner, useToast } from "@/components/ui";
import { useApp, useProject } from "@/components/shell/AppContext";
import { StageHeader } from "@/components/shell/StageHeader";
import { VideoUnavailableBanner } from "@/components/shell/VideoUnavailableBanner";
import type { AspectId, CaptionStyleId, CaptionWord, EditBrief as Brief, FormatId, Project } from "@/lib/types";
import { CaptionsEditor } from "./CaptionsEditor";
import { CutsList } from "./CutsList";
import { EditBrief } from "./EditBrief";
import { FormatPicker, FORMATS } from "./FormatPicker";
import { CutPreview } from "./Timeline";
import { VisualsEditor } from "./VisualsEditor";
import { VideoUsePanel } from "./VideoUsePanel";

type Progress = { value: number; message: string | null } | null;

const STAGE_LABEL: Record<string, string> = {
  waiting: "Preparing your footage",
  analyze: "Transcribing, picking best takes, cutting silences and fillers",
  render: "Cleaning audio and rendering your layout",
  done: "Done",
};

export function EditingWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { capabilities } = useApp();
  const { project, setProject, reload, error } = useProject(id);
  const [autoProgress, setAutoProgress] = useState<Progress>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<Progress>(null);
  const [renderProgress, setRenderProgress] = useState<Progress>(null);
  const [resourcing, setResourcing] = useState(false);
  const [selectedCut, setSelectedCut] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const attached = useRef<string | null>(null);

  const edit = project?.edit;
  const analysis = edit?.analysis?.status || "idle";
  const auto = edit?.auto;
  const readyTakes = project?.takes.filter((t) => t.status === "ready" && t.selected).length || 0;
  const processingTakes = project?.takes.filter((t) => t.status === "processing").length || 0;
  const hasFootage = (project?.takes.length || 0) > 0;

  // Imported footage may still be normalising; poll until it is ready.
  useEffect(() => {
    if (!processingTakes) return;
    const t = setInterval(() => reload(), 2000);
    return () => clearInterval(t);
  }, [processingTakes, reload]);

  const watchJob = useCallback(
    async (jobId: string, setter: (p: Progress) => void) => {
      setter({ value: 0, message: "Starting" });
      const job = await pollJob(jobId, (j) => setter({ value: j.progress, message: j.message }));
      setter(null);
      await reload();
      if (job.status === "failed") toast.push(job.error || "Job failed", "error");
      return job;
    },
    [reload, toast],
  );

  // Re-attach to jobs that are still running server-side (page refresh, another tab).
  useEffect(() => {
    if (!edit) return;
    if (auto?.status === "running" && auto.jobId && attached.current !== auto.jobId) {
      attached.current = auto.jobId;
      watchJob(auto.jobId, setAutoProgress);
      return;
    }
    if (auto?.status !== "running") {
      if (analysis === "running" && edit.analysis?.jobId && attached.current !== edit.analysis.jobId) {
        attached.current = edit.analysis.jobId;
        watchJob(edit.analysis.jobId, setAnalyzeProgress);
      }
      if (edit.render?.status === "running" && edit.render.jobId && attached.current !== edit.render.jobId) {
        attached.current = edit.render.jobId;
        watchJob(edit.render.jobId, setRenderProgress);
      }
    }
  }, [edit, auto, analysis, watchJob]);

  const outputDuration = useMemo(() => {
    const caps = edit?.captions || [];
    return caps.length ? caps[caps.length - 1].end : 0;
  }, [edit?.captions]);

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!project || !edit) return <div className="flex justify-center p-12"><Spinner /></div>;

  async function submitBrief(brief: Brief, script: string) {
    setSubmitting(true);
    try {
      const res = await api<{ job: { id: string }; project: Project }>(`/api/projects/${id}/edit/auto`, { method: "POST", body: { brief, script } });
      setProject(res.project);
      setShowBrief(false);
      setShowRefine(false);
      attached.current = res.job.id;
      const job = await watchJob(res.job.id, setAutoProgress);
      if (job.status === "done") toast.push("Your edit is ready", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSubmitting(false);
    }
  }
  async function runAnalysis() {
    try {
      const res = await api<{ job: { id: string }; project: Project }>(`/api/projects/${id}/edit/analyze`, { method: "POST" });
      setProject(res.project);
      attached.current = res.job.id;
      await watchJob(res.job.id, setAnalyzeProgress);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }
  async function toggleCut(cutId: string, enabled: boolean) {
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
  async function settings(patch: { format?: FormatId; aspect?: AspectId; captionStyle?: CaptionStyleId; captions?: CaptionWord[]; keyPhrases?: string[]; facePosition?: "top" | "bottom" }) {
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
      attached.current = res.job.id;
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
  const working = auto?.status === "running" || !!autoProgress;
  const failed = auto?.status === "failed";
  const hasResult = edit.render?.status === "done" && !!renderUrl;
  const askBrief = !working && (showBrief || (!edit.brief && analysis !== "done" && !hasResult));
  const renderBusy = !!renderProgress || edit.render?.status === "running";
  const settingsChanged = hasResult && (edit.render!.format !== edit.format || edit.render!.aspect !== edit.aspect);
  const engineLabel = edit.render?.engine === "remotion" ? "Remotion" : edit.render?.engine === "videouse" ? "video-use" : "FFmpeg";

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-4 md:py-6">
      <StageHeader stage="editing" project={project} />
      <VideoUnavailableBanner />

      {!hasFootage && (
        <Card className="p-6 text-sm text-muted">No footage yet. Go back to Shooting, record or upload a take, then send it here.</Card>
      )}

      {/* 1. Ask what kind of edit is needed */}
      {hasFootage && askBrief && (
        <Card className="mb-5 p-5">
          {processingTakes > 0 && readyTakes === 0 && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
              <Spinner /> Your video is still being prepared. Pick the edit now; it starts the moment the footage is ready.
            </div>
          )}
          <EditBrief project={project} busy={submitting} onSubmit={submitBrief} />
          {showBrief && (
            <div className="mt-3 text-right">
              <Button variant="ghost" size="sm" onClick={() => setShowBrief(false)}>Cancel</Button>
            </div>
          )}
        </Card>
      )}

      {/* 2. One job does everything */}
      {working && (
        <Card className="mb-5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Wand2 className="h-4 w-4 text-accent" /> Making your edit
          </div>
          <ProgressBar value={autoProgress?.value || 0} label={autoProgress?.message || STAGE_LABEL[auto?.stage || "waiting"] || "Working…"} />
          <div className="mt-2 text-xs text-muted">
            {STAGE_LABEL[auto?.stage || "waiting"]}. This usually takes a few minutes for a 3-minute video. You can leave and come back.
          </div>
        </Card>
      )}

      {failed && !askBrief && (
        <Card className="mb-5 border-danger/40 p-5">
          <div className="text-sm font-medium text-danger">The edit failed</div>
          <div className="mt-1 text-sm text-muted">{auto?.error}</div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={() => setShowBrief(true)}>Try again</Button>
            {analysis === "done" && <Button onClick={() => setShowRefine(true)}>Open the cut</Button>}
          </div>
        </Card>
      )}

      {/* 3. Result first */}
      {hasResult && !working && !askBrief && (
        <Card className="mb-5 p-5">
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(220px,300px)_1fr]">
            <video src={renderUrl} controls playsInline className="w-full rounded-xl bg-black" />
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold">Your edit is ready</div>
                <div className="mt-1 text-sm text-muted">
                  {FORMATS.find((f) => f.id === edit.render!.format)?.name} · {edit.render!.aspect} · {edit.render!.durationSec?.toFixed(0)}s · rendered with {engineLabel}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {stats && (
                  <>
                    {stats.retakes > 0 && <Badge tone="danger">{stats.retakes} retakes removed</Badge>}
                    {stats.fillers > 0 && <Badge tone="warning">{stats.fillers} fillers removed</Badge>}
                    {stats.pauses > 0 && <Badge tone="accent">{stats.pauses} silences removed</Badge>}
                    {edit.sourceDuration ? <Badge>{edit.sourceDuration.toFixed(0)}s → {outputDuration.toFixed(0)}s</Badge> : null}
                  </>
                )}
                {edit.transcript?.provider === "mock" && <Badge tone="warning">script aligned to speech (no speech-to-text key)</Badge>}
              </div>
              {edit.render!.warning && <div className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">{edit.render!.warning}</div>}
              {settingsChanged && <div className="text-xs text-muted">Settings changed since this render. Re-render to apply them.</div>}
              <div className="flex flex-wrap gap-2">
                <a href={renderUrl} download className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm hover:bg-surface-2">
                  <Download className="h-4 w-4" /> Download
                </a>
                <Button variant="primary" onClick={publish} loading={moving}>
                  Publish <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" onClick={() => setShowBrief(true)}>
                  <Sparkles className="h-4 w-4" /> Change the edit
                </Button>
                <Button variant="ghost" onClick={() => setShowRefine((v) => !v)}>
                  {showRefine ? "Hide fine-tuning" : "Fine-tune the cut"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Legacy / manual path: analysed but not rendered yet */}
      {!working && !askBrief && !hasResult && analysis === "idle" && readyTakes > 0 && !analyzeProgress && (
        <Card className="mb-5 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => setShowBrief(true)}>
              <Sparkles className="h-4 w-4" /> Make my edit
            </Button>
            <Button variant="ghost" onClick={runAnalysis}>
              <Wand2 className="h-4 w-4" /> Just run the cleanup pass
            </Button>
          </div>
        </Card>
      )}
      {(analysis === "running" || analyzeProgress) && !working && (
        <Card className="mb-5 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Wand2 className="h-4 w-4 text-accent" /> Cleanup pass
          </div>
          <ProgressBar value={analyzeProgress?.value || 0} label={analyzeProgress?.message || "Working…"} />
        </Card>
      )}
      {analysis === "failed" && !failed && !askBrief && (
        <Card className="mb-5 border-danger/40 p-5">
          <div className="text-sm font-medium text-danger">Cleanup failed</div>
          <div className="mt-1 text-sm text-muted">{edit.analysis?.error}</div>
          <Button className="mt-3" onClick={runAnalysis}>Try again</Button>
        </Card>
      )}

      {/* 4. Fine-tuning tools */}
      {analysis === "done" && sourceUrl && !working && !askBrief && (showRefine || !hasResult) && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            {stats && (
              <>
                <Badge tone="danger">{stats.retakes} retakes</Badge>
                <Badge tone="warning">{stats.fillers} fillers</Badge>
                <Badge tone="accent">{stats.pauses} silences</Badge>
                <Badge>−{stats.removedSec.toFixed(1)}s · final ~{outputDuration.toFixed(0)}s</Badge>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={runAnalysis} className="ml-auto">
              <RefreshCw className="h-3.5 w-3.5" /> Re-run cleanup
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
                <FormatPicker format={edit.format} aspect={edit.aspect} captionStyle={edit.captionStyle} facePosition={edit.facePosition || "bottom"} onChange={settings} />
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

          <Card className="mt-5 p-4">
            <VideoUsePanel project={project} onProject={setProject} />
          </Card>

          <Card className="mt-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{hasResult ? "Re-render with these changes" : "Render"}</div>
                <div className="text-xs text-muted">
                  {FORMATS.find((f) => f.id === edit.format)?.name}
                  {edit.format === "split" ? ` (you ${edit.facePosition || "bottom"})` : ""} · {edit.aspect} · {edit.captionStyle} captions ·{" "}
                  {capabilities?.remotion?.ok ? "Remotion templates" : "FFmpeg renderer"}
                </div>
              </div>
              <Button variant="primary" onClick={render} loading={renderBusy}>
                <Play className="h-4 w-4" /> {hasResult ? "Re-render" : "Render video"}
              </Button>
            </div>
            {renderProgress && <div className="mt-4"><ProgressBar value={renderProgress.value} label={renderProgress.message || "Rendering…"} /></div>}
            {edit.render?.status === "failed" && <div className="mt-3 text-sm text-danger">{edit.render.error}</div>}
          </Card>
          {capabilities?.transcription === "mock" && (
            <div className="mt-3 text-xs text-muted">Tip: set ELEVENLABS_API_KEY, OPENAI_API_KEY, GROQ_API_KEY or DEEPGRAM_API_KEY for real word-level transcription and retake detection.</div>
          )}
        </>
      )}
    </div>
  );
}
