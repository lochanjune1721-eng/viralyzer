"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, ChevronUp, History, RotateCcw, Wand2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { Badge, Button, Card, Chip, Spinner, useToast, cx } from "@/components/ui";
import { useProject } from "@/components/shell/AppContext";
import { StageHeader } from "@/components/shell/StageHeader";
import { describeAngle } from "@/lib/llm/prompts";
import type { Angle, Project, ScriptVariant } from "@/lib/types";
import { AngleInterview } from "./AngleInterview";

const QUICK_TWEAKS = ["Make it shorter", "More aggressive opening", "Simpler language", "Stronger payoff at the end", "Add a concrete example", "Less salesy"];

export function ScriptingWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { project, setProject, error } = useProject(id);
  const [generating, setGenerating] = useState(false);
  const [showInterview, setShowInterview] = useState<boolean | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latestGen = useMemo(() => (project ? project.scripts.reduce((m, s) => Math.max(m, s.generation), 0) : 0), [project]);
  const selected = project?.scripts.find((s) => s.id === project.selectedScriptId) || null;
  // The three most recent generated variants (refinements are shown in the editor instead).
  const variants = useMemo(() => {
    if (!project) return [];
    const gens = project.scripts.filter((s) => !s.parentId);
    const g = gens.reduce((m, s) => Math.max(m, s.generation), 0);
    return gens.filter((s) => s.generation === g);
  }, [project]);
  const history = useMemo(() => (project ? project.scripts.filter((s) => !variants.includes(s) && s.id !== selected?.id) : []), [project, variants, selected]);

  const interviewOpen = showInterview ?? (project ? project.scripts.length === 0 : true);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  if ((selected?.id ?? null) !== draftKey) {
    setDraftKey(selected?.id ?? null);
    setDraft(selected?.text || "");
  }

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!project) return <div className="flex justify-center p-12"><Spinner /></div>;

  async function generate(angle: Angle) {
    setGenerating(true);
    try {
      const res = await api<{ project: Project }>(`/api/projects/${id}/scripts`, { method: "POST", body: { angle } });
      setProject(res.project);
      setShowInterview(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setGenerating(false);
    }
  }

  async function choose(script: ScriptVariant) {
    const res = await api<{ project: Project }>(`/api/projects/${id}`, { method: "PATCH", body: { selectedScriptId: script.id } });
    setProject(res.project);
  }

  function onDraftChange(text: string) {
    setDraft(text);
    if (!selected) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await api<{ project: Project }>(`/api/projects/${id}/scripts/${selected.id}`, { method: "PATCH", body: { text } });
        setProject(res.project);
      } catch (err) {
        toast.push(err instanceof Error ? err.message : String(err), "error");
      }
    }, 700);
  }

  async function refine(text: string) {
    if (!selected || !text.trim()) return;
    setRefining(true);
    try {
      const res = await api<{ project: Project }>(`/api/projects/${id}/scripts/refine`, { method: "POST", body: { scriptId: selected.id, instruction: text, text: draft } });
      setProject(res.project);
      setInstruction("");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRefining(false);
    }
  }

  async function shootThis() {
    if (!selected) return;
    setMoving(true);
    try {
      const res = await api<{ project: Project }>(`/api/projects/${id}/stage`, { method: "POST", body: { stage: "shooting", scriptText: draft } });
      setProject(res.project);
      router.push(`/shooting/${id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setMoving(false);
    }
  }

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <StageHeader stage="scripting" project={project} />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-muted">Idea</div>
            <div className="mt-0.5 text-sm">{project.idea}</div>
            {project.reference && <div className="mt-1 truncate text-xs text-muted">Reference: {project.reference}</div>}
          </div>
          {project.scripts.length > 0 && (
            <button className="flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={() => setShowInterview(!interviewOpen)}>
              {interviewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} {interviewOpen ? "Hide angle" : "Change angle"}
            </button>
          )}
        </div>
        {project.scripts.length > 0 && !interviewOpen && (
          <div className="mt-2 text-xs text-muted">Angle: {describeAngle(project.angle).replace(/\n/g, " · ")}</div>
        )}
        {interviewOpen && (
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-3 text-sm text-muted">Before writing anything, a few quick taps on the angle you want.</div>
            <AngleInterview initial={project.angle} onGenerate={generate} busy={generating} hasScripts={project.scripts.length > 0} />
          </div>
        )}
      </Card>

      {generating && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          <Spinner /> Writing three variations with different hooks…
        </div>
      )}

      {variants.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Three variations. Pick one.</div>
            {variants[0]?.provider === "mock" && <Badge tone="warning">placeholder scripts (no LLM key)</Badge>}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {variants.map((v) => {
              const isSel = v.id === selected?.id || (selected?.parentId && rootOf(project, selected) === v.id);
              return (
                <Card key={v.id} className={cx("flex flex-col p-4 transition-colors", isSel ? "border-accent ring-1 ring-accent/40" : "")}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <Badge tone="accent">{v.hookType.replace(/_/g, " ")} hook</Badge>
                    <span className="text-xs text-muted">~{v.estimatedSeconds}s</span>
                  </div>
                  <div className="text-sm font-medium">{v.label}</div>
                  <p className="mt-2 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{v.text}</p>
                  <Button variant={isSel ? "primary" : "secondary"} className="mt-4" onClick={() => choose(v)}>
                    {isSel ? <><Check className="h-4 w-4" /> Selected</> : "Use this one"}
                  </Button>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <Card className="mt-6 p-4 fade-up">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Refine your script</div>
              <div className="text-xs text-muted">
                Edit inline or ask for tweaks. {words} words · ~{Math.max(5, Math.round(words / 2.4))}s spoken
                {selected.refineInstruction ? ` · refined: "${selected.refineInstruction}"` : ""}
              </div>
            </div>
            {selected.parentId && (
              <Button size="sm" variant="ghost" onClick={() => choose(project.scripts.find((s) => s.id === selected.parentId)!)}>
                <RotateCcw className="h-4 w-4" /> Back to previous version
              </Button>
            )}
          </div>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={Math.min(18, Math.max(8, draft.split("\n").length + 4))}
            className="mt-3 w-full resize-y rounded-xl border border-border bg-surface-2 p-3 text-[15px] leading-relaxed outline-none focus:border-accent"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_TWEAKS.map((t) => (
              <Chip key={t} onClick={() => refine(t)} disabled={refining}>
                {t}
              </Chip>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && refine(instruction)}
              placeholder='Ask for a tweak, e.g. "open with the number" or "make the ending land harder"'
              className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <Button onClick={() => refine(instruction)} loading={refining} disabled={!instruction.trim()}>
              <Wand2 className="h-4 w-4" /> Tweak
            </Button>
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <div className="text-xs text-muted">The other variations stay in history.</div>
            <Button variant="primary" size="lg" onClick={shootThis} loading={moving} disabled={!draft.trim()}>
              Shoot this <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <div className="mt-6">
          <button className="flex items-center gap-1.5 text-sm text-muted hover:text-fg" onClick={() => setShowHistory((v) => !v)}>
            <History className="h-4 w-4" /> {showHistory ? "Hide" : "Show"} history ({history.length})
          </button>
          {showHistory && (
            <div className="mt-3 space-y-2">
              {history
                .slice()
                .reverse()
                .map((s) => (
                  <Card key={s.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted">
                        Gen {s.generation} · {s.label}
                        {s.generation === latestGen ? " · latest" : ""}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => choose(s)}>
                        Restore
                      </Button>
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm text-fg/80">{s.text}</p>
                  </Card>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function rootOf(project: Project, script: ScriptVariant): string {
  let cur = script;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = project.scripts.find((s) => s.id === cur.parentId);
    if (!p) break;
    cur = p;
  }
  return cur.id;
}
