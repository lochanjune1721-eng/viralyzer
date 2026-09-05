"use client";

import { useRouter } from "next/navigation";
import { Download, FolderPlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, uploadVideoChunked } from "@/lib/api-client";
import { Button, Card, cx, formatTime, useToast } from "@/components/ui";
import { useApp } from "@/components/shell/AppContext";
import type { Project } from "@/lib/types";
import { Teleprompter, type RecordingResult } from "./Teleprompter";

const SCRIPT_KEY = "vz.prompter.script";
const SAMPLE = `Paste your script here, or type it.

The teleprompter scrolls it right under the camera lens, so you can read while keeping eye contact. Use the settings button to change how the text comes in: scrolling up, as a ticker moving left or right, or a few big words at a time.

Drag the bar to put the prompter anywhere on the frame. Press space to play or pause, the arrow keys for speed, and R to restart.`;

interface LocalRecording {
  id: string;
  url: string;
  blob: Blob;
  durationSec: number;
  createdAt: number;
}

// The teleprompter as a standalone tool: no project needed. Recordings stay
// in the browser until you download them or save them to a project.
export function ShootingStudio() {
  const router = useRouter();
  const toast = useToast();
  const { projects, upsertProject } = useApp();
  const [script, setScript] = useState(SAMPLE);
  const [loaded, setLoaded] = useState(false);
  const [recordings, setRecordings] = useState<LocalRecording[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(true);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SCRIPT_KEY);
      if (saved) setScript(saved);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(SCRIPT_KEY, script);
    } catch {
      /* ignore */
    }
  }, [script, loaded]);

  const onRecorded = useCallback((r: RecordingResult) => {
    const id = Date.now().toString(36);
    setRecordings((list) => [{ id, url: URL.createObjectURL(r.blob), blob: r.blob, durationSec: r.durationSec, createdAt: Date.now() }, ...list]);
    toast.push("Take recorded. Download it or save it to a project.", "success");
  }, [toast]);

  async function saveToProject(rec: LocalRecording) {
    setSaving(rec.id);
    try {
      const idea = script.split(/\n/).find((l) => l.trim())?.slice(0, 120) || "Teleprompter recording";
      const { project } = await api<{ project: Project }>("/api/projects", { method: "POST", body: { idea } });
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: { finalScript: script, stage: "shooting" } });
      const uploadId = await uploadVideoChunked(rec.blob, rec.blob.type.includes("mp4") ? "take.mp4" : "take.webm");
      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("source", "recorded");
      await api(`/api/projects/${project.id}/takes`, { method: "POST", body: form });
      const fresh = await api<{ project: Project }>(`/api/projects/${project.id}`);
      upsertProject(fresh.project);
      router.push(`/shooting/${project.id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setSaving(null);
    }
  }

  const withScripts = projects.filter((p) => p.finalScript || p.selectedScriptId);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,440px)_1fr]">
      <div>
        <Teleprompter script={script} onRecorded={onRecorded} />
        <div className="mt-2 text-center text-xs text-muted">Works on its own. Prompter-only mode turns the camera off if you are filming with another device.</div>
      </div>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Script</div>
            <div className="flex items-center gap-2">
              {withScripts.length > 0 && (
                <select
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
                  defaultValue=""
                  onChange={(e) => {
                    const p = projects.find((x) => x.id === e.target.value);
                    const text = p?.finalScript || p?.scripts.find((s) => s.id === p.selectedScriptId)?.text;
                    if (text) setScript(text);
                  }}
                >
                  <option value="">Load from a project…</option>
                  {withScripts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )}
              <button className="text-xs text-muted hover:text-fg" onClick={() => setShowScript((v) => !v)}>
                {showScript ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {showScript && (
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={10}
              className="mt-2 w-full resize-y rounded-xl border border-border bg-surface-2 p-3 text-sm leading-relaxed outline-none focus:border-accent"
            />
          )}
          <div className="mt-1 text-xs text-muted">{script.trim().split(/\s+/).filter(Boolean).length} words · ~{Math.round(script.trim().split(/\s+/).filter(Boolean).length / 2.4)}s spoken · saved in this browser</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium">Recordings ({recordings.length})</div>
          {recordings.length === 0 && <div className="mt-1 text-sm text-muted">Hit the red button. Takes land here, ready to download or send into Editing.</div>}
          <div className="mt-2 space-y-2">
            {recordings.map((r) => (
              <div key={r.id} className={cx("flex items-center gap-3 rounded-xl border border-border p-2")}>
                <video src={r.url} controls playsInline className="h-20 w-12 rounded-lg bg-black object-cover" />
                <div className="min-w-0 flex-1 text-xs text-muted">
                  <div className="text-sm font-medium text-fg">Take · {formatTime(r.durationSec)}</div>
                  {new Date(r.createdAt).toLocaleTimeString()} · {(r.blob.size / 1024 / 1024).toFixed(1)} MB
                </div>
                <a href={r.url} download={`take-${r.id}.${r.blob.type.includes("mp4") ? "mp4" : "webm"}`} className="rounded-lg p-2 text-muted hover:text-fg" title="Download">
                  <Download className="h-4 w-4" />
                </a>
                <Button size="sm" variant="primary" onClick={() => saveToProject(r)} loading={saving === r.id}>
                  <FolderPlus className="h-4 w-4" /> Save & edit
                </Button>
                <button className="rounded-lg p-2 text-muted hover:text-danger" title="Discard" onClick={() => setRecordings((l) => l.filter((x) => x.id !== r.id))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
