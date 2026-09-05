"use client";

import { RotateCcw, Scissors } from "lucide-react";
import { cx, formatTimeMs, Button } from "@/components/ui";
import type { EditCut } from "@/lib/types";
import { CUT_COLORS, CUT_LABELS } from "./Timeline";

export function CutsList({
  cuts,
  selectedCutId,
  onToggle,
  onSelect,
  onAll,
}: {
  cuts: EditCut[];
  selectedCutId: string | null;
  onToggle: (id: string, enabled: boolean) => void;
  onSelect: (id: string) => void;
  onAll: (enable: boolean) => void;
}) {
  const enabled = cuts.filter((c) => c.enabled).length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">
          Cuts <span className="text-muted">({enabled} of {cuts.length} applied)</span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onAll(false)}>
            <RotateCcw className="h-3.5 w-3.5" /> Undo all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAll(true)}>
            <Scissors className="h-3.5 w-3.5" /> Apply all
          </Button>
        </div>
      </div>
      {cuts.length === 0 && <div className="text-sm text-muted">Nothing to cut. Clean take!</div>}
      <div className="scrollbar-thin max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {cuts.map((c) => (
          <div
            key={c.id}
            className={cx("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm", selectedCutId === c.id ? "border-fg/40 bg-surface-2" : "border-border", !c.enabled && "opacity-60")}
            onClick={() => onSelect(c.id)}
          >
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CUT_COLORS[c.reason] }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{CUT_LABELS[c.reason]}</span>
                <span className="text-xs text-muted">
                  {formatTimeMs(c.start)}–{formatTimeMs(c.end)} · {(c.end - c.start).toFixed(1)}s
                </span>
              </div>
              {c.detail && <div className="truncate text-xs text-muted">{c.detail}</div>}
            </div>
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={c.enabled} onChange={(e) => onToggle(c.id, e.target.checked)} /> cut
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
