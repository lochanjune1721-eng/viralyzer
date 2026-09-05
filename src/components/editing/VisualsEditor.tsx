"use client";

import { ImageOff, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { api, mediaUrl } from "@/lib/api-client";
import { Button, Modal, Spinner, cx, formatTimeMs, useToast } from "@/components/ui";
import type { Project, Visual } from "@/lib/types";
import type { ImageResult } from "@/lib/editing/visuals";

export function VisualsEditor({ project, onProject, onResource, resourcing }: { project: Project; onProject: (p: Project) => void; onResource: () => void; resourcing: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Visual | null>(null);
  const visuals = project.edit.visuals;

  async function patch(visualId: string, body: Record<string, unknown>) {
    try {
      const res = await api<{ project: Project }>(`/api/projects/${project.id}/edit/visuals`, { method: "PATCH", body: { visualId, ...body } });
      onProject(res.project);
      return true;
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      return false;
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">
          Visuals <span className="text-muted">({visuals.length}) · auto-picked from what you say</span>
        </div>
        <Button size="sm" variant="ghost" onClick={onResource} loading={resourcing}>
          <RefreshCw className="h-3.5 w-3.5" /> Re-source all
        </Button>
      </div>
      {visuals.length === 0 && <div className="text-sm text-muted">{resourcing ? "Finding images…" : "No visuals yet."}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visuals.map((v) => (
          <div key={v.id} className="overflow-hidden rounded-xl border border-border bg-surface">
            <button className="relative block aspect-video w-full bg-surface-2" onClick={() => setEditing(v)} title="Replace image">
              {v.file ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(v.file) || ""} alt={v.query} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted">
                  <ImageOff className="h-5 w-5" />
                </div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {formatTimeMs(v.start)}–{formatTimeMs(v.end)}
              </span>
            </button>
            <div className="p-2">
              <div className="truncate text-xs font-medium" title={v.concept}>
                {v.concept || v.query}
              </div>
              <div className="truncate text-[11px] text-muted">{v.source ? `${v.source}${v.credit ? ` · ${v.credit}` : ""}` : "no image"}</div>
              <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setEditing(v)}>
                Replace
              </button>
            </div>
          </div>
        ))}
      </div>
      <ImageSearchModal
        visual={editing}
        onClose={() => setEditing(null)}
        onPick={async (r) => {
          if (!editing) return;
          const ok = await patch(editing.id, { imageUrl: r.url, source: r.source, credit: r.credit, query: r.query });
          if (ok) setEditing(null);
        }}
        onRemove={async () => {
          if (!editing) return;
          if (await patch(editing.id, { remove: true })) setEditing(null);
        }}
      />
    </div>
  );
}

function ImageSearchModal({ visual, onClose, onPick, onRemove }: { visual: Visual | null; onClose: () => void; onPick: (r: ImageResult & { query: string }) => Promise<void>; onRemove: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ImageResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [lastVisual, setLastVisual] = useState<string | null>(null);

  if (visual && visual.id !== lastVisual) {
    setLastVisual(visual.id);
    setQ(visual.query);
    setResults([]);
    setCustomUrl("");
  }

  async function search(query: string) {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const data = await api<{ results: ImageResult[] }>(`/api/images/search?q=${encodeURIComponent(query.trim())}`);
      setResults(data.results);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!visual} onClose={onClose} title={visual ? `Replace image · ${visual.concept || visual.query}` : ""} wide>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search(q)} placeholder="Search the web for an image" className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <Button onClick={() => search(q)} loading={busy}>
          <Search className="h-4 w-4" /> Search
        </Button>
      </div>
      <div className="mt-3 grid min-h-[120px] grid-cols-2 gap-2 sm:grid-cols-4">
        {busy && results.length === 0 && (
          <div className="col-span-full flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {results.map((r) => (
          <button key={r.url} className={cx("group relative aspect-video overflow-hidden rounded-lg bg-surface-2", picking === r.url && "ring-2 ring-accent")} onClick={async () => {
            setPicking(r.url);
            await onPick({ ...r, query: q });
            setPicking(null);
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.thumb} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
            <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white">{r.source}{r.credit ? ` · ${r.credit}` : ""}</span>
          </button>
        ))}
        {!busy && results.length === 0 && <div className="col-span-full py-6 text-center text-sm text-muted">Search to see images, or paste a direct image URL below.</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://…/image.jpg" className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
        <Button onClick={() => onPick({ url: customUrl, thumb: customUrl, source: "custom", query: q })} disabled={!/^https?:\/\//.test(customUrl)}>
          Use URL
        </Button>
        <Button variant="danger" onClick={onRemove}>
          No image
        </Button>
      </div>
    </Modal>
  );
}
