"use client";

import { Star, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { mediaUrl } from "@/lib/api-client";
import { Badge, Button, cx, formatTime } from "@/components/ui";
import type { TakeRecording } from "@/lib/types";

export function TakesList({
  takes,
  onPrimary,
  onToggle,
  onDelete,
  onUpload,
  uploading,
}: {
  takes: TakeRecording[];
  onPrimary: (id: string) => void;
  onToggle: (id: string, selected: boolean) => void;
  onDelete: (id: string) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">Takes ({takes.length})</div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()} loading={uploading}>
          <Upload className="h-4 w-4" /> Upload a video
        </Button>
      </div>
      {takes.length === 0 && <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">Record with the teleprompter or upload footage you shot elsewhere. You can record as many takes as you like.</div>}
      <div className="space-y-2">
        {takes.map((t) => (
          <div key={t.id} className={cx("flex items-center gap-3 rounded-xl border bg-surface p-2", t.primary ? "border-accent/60" : "border-border")}>
            <div className="h-20 w-12 shrink-0 overflow-hidden rounded-lg bg-black">
              {t.status === "ready" ? (
                <video src={mediaUrl(t.file) || undefined} preload="metadata" muted playsInline controls={false} className="h-full w-full object-cover" onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())} />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-white/60">{t.status === "failed" ? "failed" : "…"}</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{t.name}</span>
                {t.primary && <Badge tone="accent">Primary</Badge>}
                {t.status === "processing" && <Badge tone="warning">Processing</Badge>}
                {t.status === "failed" && <Badge tone="danger">Failed</Badge>}
              </div>
              <div className="text-xs text-muted">
                {t.durationSec ? formatTime(t.durationSec) : ""} {t.width ? `· ${t.width}×${t.height}` : ""} · {t.source}
                {t.error ? ` · ${t.error}` : ""}
              </div>
              <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={t.selected} onChange={(e) => onToggle(t.id, e.target.checked)} disabled={t.status !== "ready"} /> include in edit
              </label>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button className={cx("rounded-lg p-2", t.primary ? "text-accent" : "text-muted hover:text-fg")} title="Mark as primary" onClick={() => onPrimary(t.id)} disabled={t.status !== "ready"}>
                <Star className={cx("h-4 w-4", t.primary && "fill-current")} />
              </button>
              <button className="rounded-lg p-2 text-muted hover:text-danger" title="Delete take" onClick={() => onDelete(t.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
