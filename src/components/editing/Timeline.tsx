"use client";

import { useEffect, useRef, useState } from "react";
import { cx, formatTime } from "@/components/ui";
import type { EditCut } from "@/lib/types";

export const CUT_COLORS: Record<EditCut["reason"], string> = {
  retake: "var(--cut-retake)",
  false_start: "var(--cut-retake)",
  filler: "var(--cut-filler)",
  pause: "var(--cut-pause)",
  lead: "var(--cut-lead)",
  tail: "var(--cut-lead)",
};

export const CUT_LABELS: Record<EditCut["reason"], string> = {
  retake: "Repeated line",
  false_start: "False start",
  filler: "Filler",
  pause: "Long pause",
  lead: "Dead air (start)",
  tail: "Dead air (end)",
};

/**
 * Preview player that skips over enabled cuts, plus a timeline where every
 * cut is visible and can be toggled with a click.
 */
export function CutPreview({
  src,
  duration,
  cuts,
  onToggle,
  onSelectCut,
  selectedCutId,
}: {
  src: string;
  duration: number;
  cuts: EditCut[];
  onToggle: (cutId: string, enabled: boolean) => void;
  onSelectCut: (cutId: string | null) => void;
  selectedCutId: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cutsRef = useRef(cuts);
  const [time, setTime] = useState(0);
  const [skipCuts, setSkipCuts] = useState(true);
  const skipRef = useRef(true);
  useEffect(() => {
    cutsRef.current = cuts;
    skipRef.current = skipCuts;
  }, [cuts, skipCuts]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const t = v.currentTime;
      setTime(t);
      if (skipRef.current && !v.paused) {
        const hit = cutsRef.current.find((c) => c.enabled && t >= c.start && t < c.end - 0.02);
        if (hit) {
          // jump past this cut and any cut that immediately follows
          let target = hit.end;
          for (let guard = 0; guard < 50; guard++) {
            const next = cutsRef.current.find((c) => c.enabled && target >= c.start - 0.01 && target < c.end);
            if (!next) break;
            target = next.end;
          }
          if (target >= duration - 0.05) v.pause();
          else v.currentTime = target;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(duration, t));
  };

  return (
    <div>
      <div className="mx-auto max-w-[360px] overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} src={src} controls playsInline className="max-h-[60vh] w-full" style={{ aspectRatio: "9 / 16" }} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={skipCuts} onChange={(e) => setSkipCuts(e.target.checked)} /> Preview with cuts applied
        </label>
      </div>
      <Timeline duration={duration} cuts={cuts} time={time} onSeek={seek} onToggle={onToggle} onSelectCut={onSelectCut} selectedCutId={selectedCutId} />
    </div>
  );
}

export function Timeline({
  duration,
  cuts,
  time,
  onSeek,
  onToggle,
  onSelectCut,
  selectedCutId,
}: {
  duration: number;
  cuts: EditCut[];
  time: number;
  onSeek: (t: number) => void;
  onToggle: (cutId: string, enabled: boolean) => void;
  onSelectCut: (cutId: string | null) => void;
  selectedCutId: string | null;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(Math.max(0, Math.min(duration, t)) / Math.max(0.001, duration)) * 100}%`;
  return (
    <div className="mt-2">
      <div
        ref={barRef}
        className="relative h-10 w-full cursor-pointer overflow-hidden rounded-lg bg-surface-2"
        onClick={(e) => {
          const r = barRef.current!.getBoundingClientRect();
          onSeek(((e.clientX - r.left) / r.width) * duration);
          onSelectCut(null);
        }}
      >
        {cuts.map((c) => (
          <button
            key={c.id}
            type="button"
            title={`${CUT_LABELS[c.reason]}: ${c.detail || ""} (${c.enabled ? "click to keep" : "click to cut"})`}
            className={cx("absolute top-0 h-full min-w-[3px] border-x border-black/10 transition-opacity", c.enabled ? "opacity-90" : "opacity-25", selectedCutId === c.id && "ring-2 ring-fg")}
            style={{ left: pct(c.start), width: `max(3px, calc(${pct(c.end)} - ${pct(c.start)}))`, background: CUT_COLORS[c.reason] }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCut(c.id);
              onToggle(c.id, !c.enabled);
            }}
          />
        ))}
        <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-fg" style={{ left: pct(time) }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted">
        <Legend color={CUT_COLORS.retake} label="Retakes / false starts" />
        <Legend color={CUT_COLORS.filler} label="Fillers" />
        <Legend color={CUT_COLORS.pause} label="Pauses" />
        <Legend color={CUT_COLORS.lead} label="Dead air" />
        <span>Faded = cut undone</span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}
