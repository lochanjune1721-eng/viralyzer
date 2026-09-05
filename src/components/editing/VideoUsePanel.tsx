"use client";

import { Check, Eye, MessageSquare, Play, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, mediaUrl, pollJob } from "@/lib/api-client";
import { Badge, Button, Modal, ProgressBar, Spinner, cx, formatTimeMs, useToast } from "@/components/ui";
import { useApp } from "@/components/shell/AppContext";
import type { Edl, Project, VideoUseMessage, VideoUseState } from "@/lib/types";

const GRADES = [
  { id: "auto", name: "Auto", hint: "Clean, corrective, no look" },
  { id: "subtle", name: "Subtle", hint: "Barely-there polish" },
  { id: "neutral_punch", name: "Neutral punch", hint: "Contrast + S-curve" },
  { id: "warm_cinematic", name: "Warm cinematic", hint: "Teal/orange, filmic" },
  { id: "none", name: "None", hint: "Straight copy" },
];

const SUGGESTIONS = ["Cut it down to 45 seconds", "Tighten every pause", "Warm cinematic grade", "Drop the weakest beat", "Keep only the hook and the payoff", "No subtitles"];

// "Edit by conversation": the video-use engine inside the Editing stage.
export function VideoUsePanel({ project, onProject }: { project: Project; onProject: (p: Project) => void }) {
  const toast = useToast();
  const { capabilities } = useApp();
  const [state, setState] = useState<VideoUseState | null>(project.edit.videouse || null);
  const [edl, setEdl] = useState<Edl | null>(project.edit.videouse?.edl || null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [rendering, setRendering] = useState<{ value: number; message: string | null } | null>(null);
  const [inspect, setInspect] = useState<{ title: string; file: string | null; loading: boolean } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const engineOk = capabilities?.videouse?.ok ?? true;

  // Load the starting EDL (auto-cleanup result) once analysis exists.
  useEffect(() => {
    api<{ edl: Edl | null; videouse: VideoUseState | null }>(`/api/projects/${project.id}/edit/videouse/edl`)
      .then((d) => {
        setEdl(d.edl);
        if (d.videouse) setState(d.videouse);
      })
      .catch(() => {});
  }, [project.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state?.messages.length, thinking]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || thinking) return;
    setInput("");
    setThinking(true);
    setState((s) => ({ ...(s || { messages: [], edl: null, grade: "auto", subtitleStyle: "bold-overlay" }), messages: [...(s?.messages || []), { id: "tmp", role: "user", content: message, createdAt: new Date().toISOString() }] }));
    try {
      const res = await api<{ message: VideoUseMessage; videouse: VideoUseState }>(`/api/projects/${project.id}/edit/videouse/chat`, { method: "POST", body: { message } });
      setState(res.videouse);
      if (res.message.applied && res.message.edl) setEdl(res.message.edl);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setState((s) => (s ? { ...s, messages: s.messages.filter((m) => m.id !== "tmp") } : s));
    } finally {
      setThinking(false);
    }
  }

  async function patchEdl(body: Record<string, unknown>) {
    try {
      const res = await api<{ edl: Edl; videouse: VideoUseState; project: Project }>(`/api/projects/${project.id}/edit/videouse/edl`, { method: "PATCH", body });
      setEdl(res.edl);
      setState(res.videouse);
      onProject(res.project);
      return true;
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      return false;
    }
  }

  async function applyMessage(m: VideoUseMessage) {
    if (!m.edl) return;
    if (await patchEdl({ edl: m.edl, messageId: m.id })) toast.push("Plan applied. Render a preview to check it.", "success");
  }

  async function removeRange(i: number) {
    if (!edl) return;
    const next = { ...edl, ranges: edl.ranges.filter((_, k) => k !== i) };
    await patchEdl({ edl: next });
  }

  async function nudge(i: number, edge: "start" | "end", delta: number) {
    if (!edl) return;
    const ranges = edl.ranges.map((r, k) => (k === i ? { ...r, [edge]: +(r[edge] + delta).toFixed(2) } : r));
    await patchEdl({ edl: { ...edl, ranges } });
  }

  async function render(preview: boolean) {
    try {
      const res = await api<{ job: { id: string }; videouse: VideoUseState }>(`/api/projects/${project.id}/edit/videouse/render`, { method: "POST", body: { preview } });
      setState(res.videouse);
      setRendering({ value: 0, message: "Starting the video-use render" });
      const job = await pollJob(res.job.id, (j) => setRendering({ value: j.progress, message: j.message }));
      setRendering(null);
      const fresh = await api<{ project: Project }>(`/api/projects/${project.id}`);
      onProject(fresh.project);
      setState(fresh.project.edit.videouse || null);
      if (job.status === "failed") toast.push(job.error || "Render failed", "error");
      else toast.push(preview ? "Preview ready" : "Final render ready", "success");
    } catch (err) {
      setRendering(null);
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function openInspect(start: number, end: number, target: "source" | "render", title: string) {
    setInspect({ title, file: null, loading: true });
    try {
      const res = await api<{ file: string }>(`/api/projects/${project.id}/edit/videouse/timeline?start=${start}&end=${end}&target=${target}`);
      setInspect({ title, file: res.file, loading: false });
    } catch (err) {
      setInspect(null);
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const renderFile = state?.render?.status === "done" ? state.render.file : null;
  const messages = state?.messages || [];
  const total = edl ? edl.ranges.reduce((s, r) => s + (r.end - r.start), 0) : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="h-4 w-4 text-accent" /> Edit by conversation
            <Badge tone="accent">video-use engine</Badge>
          </div>
          <div className="text-xs text-muted">
            Tell the editor what you want. It reads the word-timed transcript, proposes a plan, you confirm, it renders with per-segment grade, 30ms audio fades, subtitles last and social loudness.
          </div>
        </div>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/projects/${project.id}/edit/videouse/chat`, { method: "DELETE" }); setState((s) => (s ? { ...s, messages: [] } : s)); }}>
            <Trash2 className="h-3.5 w-3.5" /> Clear chat
          </Button>
        )}
      </div>

      {!engineOk && (
        <div className="mb-3 rounded-xl border border-warning/50 bg-warning/10 p-3 text-xs">
          <span className="font-medium">Engine not available on this server.</span> {capabilities?.videouse?.reason}
        </div>
      )}
      {capabilities?.llm === "mock" && (
        <div className="mb-3 rounded-xl border border-border bg-surface-2 p-3 text-xs text-muted">
          No DEEPSEEK_API_KEY, so the editor only follows direct instructions (length, grade, subtitles, “drop the part about…”, reset). Add the key for a real back-and-forth.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* Chat */}
        <div className="flex min-h-[320px] flex-col rounded-xl border border-border bg-surface-2">
          <div className="scrollbar-thin max-h-[420px] flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && (
              <div className="text-sm text-muted">
                The automatic cleanup is your starting point ({edl ? `${edl.ranges.length} segments, ${total.toFixed(1)}s` : "…"}). Ask for anything: a target length, a different structure, a grade, which beats to keep.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm", m.role === "user" ? "bg-accent text-white" : "bg-surface border border-border")}>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.strategy && <div className="mt-2 rounded-lg bg-surface-2 p-2 text-xs text-muted">{m.strategy}</div>}
                  {m.edl && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <Badge>{m.edl.ranges.length} segments · {m.edl.total_duration_s.toFixed(1)}s · {m.edl.grade} · subs {m.edl.subtitles}</Badge>
                      {m.applied ? (
                        <span className="flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" /> applied</span>
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => applyMessage(m)}>
                          <Check className="h-3.5 w-3.5" /> Apply this plan
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-muted"><Spinner className="h-4 w-4" /> Reading the transcript…</div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="border-t border-border p-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-fg" onClick={() => send(s)} disabled={thinking}>
                  <Sparkles className="mr-1 inline h-3 w-3" />{s}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder='e.g. "make it 30 seconds, keep the GPT-6 line, warm grade"'
                className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <Button variant="primary" onClick={() => send(input)} loading={thinking} disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Current EDL */}
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Current edit {edl ? `· ${total.toFixed(1)}s` : ""}</div>
              <Button size="sm" variant="ghost" onClick={() => patchEdl({ reset: true })} title="Back to the automatic cleanup">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
            <div className="scrollbar-thin mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {(edl?.ranges || []).map((r, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.beat || `Segment ${i + 1}`}</span>
                    <span className="text-muted">{formatTimeMs(r.start)}–{formatTimeMs(r.end)} · {(r.end - r.start).toFixed(1)}s</span>
                  </div>
                  {r.quote && <div className="mt-0.5 line-clamp-2 text-muted">“{r.quote}”</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Nudge label="start" onMinus={() => nudge(i, "start", -0.2)} onPlus={() => nudge(i, "start", 0.2)} />
                    <Nudge label="end" onMinus={() => nudge(i, "end", -0.2)} onPlus={() => nudge(i, "end", 0.2)} />
                    <button className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-fg" title="Filmstrip + waveform around this cut" onClick={() => openInspect(Math.max(0, r.start - 1.5), r.start + 1.5, "source", `Cut in at ${formatTimeMs(r.start)}`)}>
                      <Eye className="mr-1 inline h-3 w-3" />inspect
                    </button>
                    <button className="rounded px-1.5 py-0.5 text-muted hover:text-danger" onClick={() => removeRange(i)} title="Drop this segment">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-2 p-3 text-xs">
            <div className="mb-1 font-medium">Colour grade</div>
            <div className="flex flex-wrap gap-1.5">
              {GRADES.map((g) => (
                <button key={g.id} onClick={() => patchEdl({ grade: g.id })} title={g.hint} className={cx("rounded-lg border px-2 py-1", (edl?.grade || "auto") === g.id ? "border-accent bg-accent/10 text-fg" : "border-border text-muted hover:text-fg")}>
                  {g.name}
                </button>
              ))}
            </div>
            <div className="mb-1 mt-3 font-medium">Subtitles</div>
            <div className="flex gap-1.5">
              {(["bold-overlay", "none"] as const).map((s) => (
                <button key={s} onClick={() => patchEdl({ subtitles: s })} className={cx("rounded-lg border px-2 py-1", (edl?.subtitles || "bold-overlay") === s ? "border-accent bg-accent/10 text-fg" : "border-border text-muted hover:text-fg")}>
                  {s === "bold-overlay" ? "Bold 2-word caps" : "Off"}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => render(true)} loading={!!rendering} disabled={!engineOk || !edl?.ranges.length}>
                <Play className="h-3.5 w-3.5" /> Preview
              </Button>
              <Button size="sm" variant="primary" onClick={() => render(false)} loading={!!rendering} disabled={!engineOk || !edl?.ranges.length}>
                <Play className="h-3.5 w-3.5" /> Final render
              </Button>
            </div>
            {rendering && <div className="mt-2"><ProgressBar value={rendering.value} label={rendering.message || "Rendering…"} /></div>}
            {state?.render?.status === "failed" && <div className="mt-2 text-xs text-danger">{state.render.error}</div>}
            {renderFile && !rendering && (
              <div className="mt-3">
                <video src={mediaUrl(renderFile) || undefined} controls playsInline className="w-full rounded-lg bg-black" />
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                  <span>{state?.render?.preview ? "Preview (1080p, CRF 22)" : "Final (1080p, CRF 20)"} · {state?.render?.durationSec?.toFixed(1)}s · this is now the project’s deliverable</span>
                  <button className="hover:text-fg" onClick={() => openInspect(0, Math.min(4, state?.render?.durationSec || 4), "render", "Rendered output, first seconds")}>
                    <Eye className="mr-1 inline h-3 w-3" />self-check
                  </button>
                </div>
                {state?.render?.log && (
                  <button className="mt-1 text-[11px] text-muted hover:text-fg" onClick={() => setShowLog((v) => !v)}>
                    {showLog ? "hide" : "show"} engine log
                  </button>
                )}
                {showLog && <pre className="scrollbar-thin mt-1 max-h-40 overflow-auto rounded bg-black/80 p-2 text-[10px] text-white/80">{state?.render?.log}</pre>}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={!!inspect} onClose={() => setInspect(null)} title={inspect?.title || ""} wide>
        {inspect?.loading ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : inspect?.file ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(inspect.file) || ""} alt={inspect.title} className="w-full rounded-lg" />
        ) : null}
        <div className="mt-2 text-xs text-muted">Filmstrip, waveform and word labels for the range. Shaded bands are silences ≥ 400ms, the cleanest places to cut.</div>
      </Modal>
      <div className="mt-2 text-right text-[10px] text-muted">
        Editing engine vendored from <a className="underline" href="https://github.com/browser-use/video-use" target="_blank" rel="noreferrer">browser-use/video-use</a> (MIT).
      </div>
    </div>
  );
}

function Nudge({ label, onMinus, onPlus }: { label: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-border">
      <button className="px-1 text-muted hover:text-fg" onClick={onMinus} title={`${label} −0.2s`}>−</button>
      <span className="px-0.5 text-[10px] text-muted">{label}</span>
      <button className="px-1 text-muted hover:text-fg" onClick={onPlus} title={`${label} +0.2s`}>+</button>
    </span>
  );
}
