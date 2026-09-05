"use client";

import { Check, Circle, Play } from "lucide-react";
import { cx } from "@/components/ui";
import type { Stage } from "@/lib/types";

// Small animated illustrations of what each workspace looks like. Pure CSS so
// they render anywhere (including hosts without ffmpeg or a camera).
export function StagePreview({ stage }: { stage: Stage }) {
  switch (stage) {
    case "ideation":
      return (
        <Frame>
          <div className="rounded-xl border border-border bg-surface p-3 text-sm text-muted">
            <span className="text-fg">GPT-6 just launched and everyone is wrong about it</span>
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-middle" />
          </div>
          <div className="mt-2 flex justify-end">
            <span className="btn-primary-glow rounded-lg px-3 py-1.5 text-xs font-medium text-white">Script this →</span>
          </div>
        </Frame>
      );
    case "scripting":
      return (
        <Frame>
          <div className="flex flex-wrap gap-1.5">
            {["Explainer", "Hot take", "Contrarian", "Story"].map((c, i) => (
              <span key={c} className={cx("rounded-full border px-2 py-0.5 text-[11px]", i === 2 ? "border-[#5b8def] bg-[#5b8def]/15 text-fg" : "border-border text-muted")}>
                {c}
              </span>
            ))}
          </div>
          <div className="stagger mt-3 grid grid-cols-3 gap-2">
            {["question", "bold claim", "story"].map((h, i) => (
              <div key={h} className={cx("rounded-lg border p-2", i === 1 ? "border-[#5b8def]" : "border-border")}>
                <div className="rounded bg-[#5b8def]/15 px-1.5 py-0.5 text-[10px] text-[#5b8def]">{h} hook</div>
                <div className="mt-1.5 space-y-1">
                  {[100, 85, 92, 60].map((w, k) => (
                    <div key={k} className="bar-grow h-1.5 rounded bg-border" style={{ width: `${w}%`, animationDelay: `${0.2 + i * 0.15 + k * 0.08}s` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Frame>
      );
    case "shooting":
      return (
        <Frame>
          <div className="relative mx-auto h-56 w-32 overflow-hidden rounded-xl bg-gradient-to-b from-[#3a2a3f] to-[#1d1a22]">
            <div className="absolute left-1/2 top-[52%] h-16 w-16 -translate-x-1/2 rounded-full bg-[#d0a58a]" />
            <div className="absolute inset-x-0 top-0 h-[45%] overflow-hidden bg-gradient-to-b from-black/80 to-transparent">
              <div className="teleprompter-demo px-2 pt-6 text-center text-[9px] font-semibold leading-snug text-white">
                {"GPT-6 just launched and everyone is wrong about it. The model nobody is talking about matters more. Here is why. ".repeat(2)}
              </div>
            </div>
            <div className="absolute bottom-2 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-red-500">
              <Circle className="pulse-ring h-3 w-3 rounded-full fill-white text-white" />
            </div>
            <span className="absolute left-1.5 top-1.5 rounded-full bg-red-600 px-1.5 text-[8px] font-semibold text-white">● REC 0:12</span>
          </div>
        </Frame>
      );
    case "editing":
      return (
        <Frame>
          <div className="flex gap-3">
            <div className="relative h-36 w-20 shrink-0 overflow-hidden rounded-lg bg-black">
              <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[#3a2a3f] to-[#2a2230]" />
              <div className="absolute left-1/2 top-[18%] h-8 w-8 -translate-x-1/2 rounded-full bg-[#d0a58a]" />
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-br from-sky-500 to-indigo-600" />
              <div className="absolute inset-x-1 top-[46%] text-center text-[8px] font-black uppercase text-white" style={{ textShadow: "0 0 2px #000" }}>
                EVERYONE <span className="caption-pop inline-block text-yellow-300">IS</span> WRONG
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative h-6 w-full overflow-hidden rounded bg-surface-2">
                {[
                  [0, 4, "#8a8378"],
                  [18, 12, "#d1453b"],
                  [42, 3, "#d69a2a"],
                  [60, 8, "#5b7fd6"],
                  [78, 6, "#d1453b"],
                  [96, 4, "#8a8378"],
                ].map(([l, w, c], i) => (
                  <div key={i} className="bar-grow absolute top-0 h-full" style={{ left: `${l}%`, width: `${w}%`, background: c as string, animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
              <div className="mt-2 space-y-1.5 text-[11px]">
                {[
                  ["Repeated line", "kept the best take"],
                  ["Filler", '"um"'],
                  ["Long pause", "2.4s → 0.4s"],
                ].map(([a, b]) => (
                  <div key={a} className="flex items-center gap-1.5 text-muted">
                    <Check className="h-3 w-3 text-success" /> <span className="text-fg">{a}</span> · {b}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                {["Split", "Overlay", "Captions", "Motion"].map((f, i) => (
                  <span key={f} className={cx("rounded border px-1.5 py-0.5 text-[10px]", i === 0 ? "border-accent text-fg" : "border-border text-muted")}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Frame>
      );
    case "uploading":
      return (
        <Frame>
          <div className="stagger grid grid-cols-5 gap-1.5">
            {[
              ["♪", "TikTok", true],
              ["◎", "Reels", true],
              ["▶", "Shorts", true],
              ["𝕏", "X", false],
              ["in", "LinkedIn", true],
            ].map(([ic, name, ok]) => (
              <div key={name as string} className="rounded-lg border border-border p-1.5 text-center">
                <div className="text-sm font-bold">{ic as string}</div>
                <div className="text-[9px] text-muted">{name as string}</div>
                <div className={cx("mx-auto mt-1 h-1.5 w-1.5 rounded-full", ok ? "bg-success" : "bg-border")} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-border p-2">
            <div className="text-[11px] text-muted">
              <span className="text-fg">Posted to 4 platforms</span> · 1 scheduled
            </div>
            <span className="btn-primary-glow flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white">
              <Play className="h-3 w-3" /> Post everywhere
            </span>
          </div>
        </Frame>
      );
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface/80 p-3 shadow-lg shadow-black/5 backdrop-blur">{children}</div>;
}
