"use client";

import { cx } from "@/components/ui";
import { CAPTION_STYLES } from "@/lib/editing/captions";
import type { AspectId, CaptionStyleId, FormatId } from "@/lib/types";

export const FORMATS: Array<{ id: FormatId; name: string; blurb: string }> = [
  { id: "split", name: "Split screen", blurb: "You on top, auto-sourced visuals below" },
  { id: "overlay", name: "Full-frame + overlays", blurb: "You fill the frame, visuals pop in the lower third" },
  { id: "captions", name: "Captions only", blurb: "You full-frame with word-by-word captions" },
  { id: "motion", name: "Motion design", blurb: "Kinetic typography and a lower third" },
];

const ASPECTS: Array<{ id: AspectId; name: string; hint: string }> = [
  { id: "9:16", name: "9:16", hint: "TikTok, Reels, Shorts" },
  { id: "1:1", name: "1:1", hint: "Feed" },
  { id: "16:9", name: "16:9", hint: "YouTube, LinkedIn" },
];

export function FormatPicker({
  format,
  aspect,
  captionStyle,
  onChange,
}: {
  format: FormatId;
  aspect: AspectId;
  captionStyle: CaptionStyleId;
  onChange: (patch: { format?: FormatId; aspect?: AspectId; captionStyle?: CaptionStyleId }) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-medium">Format</div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => onChange({ format: f.id })}
              className={cx("flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors", format === f.id ? "border-accent bg-accent/5" : "border-border hover:border-fg/30")}
            >
              <FormatThumb id={f.id} />
              <div>
                <div className="text-sm font-medium">{f.name}</div>
                <div className="text-xs text-muted">{f.blurb}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-medium">Aspect ratio</div>
          <div className="flex gap-2">
            {ASPECTS.map((a) => (
              <button key={a.id} onClick={() => onChange({ aspect: a.id })} className={cx("flex-1 rounded-xl border px-3 py-2 text-sm", aspect === a.id ? "border-accent bg-accent/5" : "border-border hover:border-fg/30")}>
                <div className="font-medium">{a.name}</div>
                <div className="text-[11px] text-muted">{a.hint}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Caption style</div>
          <div className="grid grid-cols-2 gap-2">
            {CAPTION_STYLES.map((s) => (
              <button key={s.id} onClick={() => onChange({ captionStyle: s.id })} className={cx("rounded-xl border px-3 py-2 text-left", captionStyle === s.id ? "border-accent bg-accent/5" : "border-border hover:border-fg/30")} title={s.description}>
                <CaptionSample id={s.id} />
                <div className="mt-1 text-xs text-muted">{s.name}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormatThumb({ id }: { id: FormatId }) {
  const base = "relative h-16 w-9 overflow-hidden rounded-md bg-neutral-800";
  const face = "absolute bg-[#d0a58a]";
  return (
    <div className={base}>
      {id === "split" && (
        <>
          <div className={cx(face, "inset-x-0 top-0 h-1/2")} />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-sky-500/80" />
          <div className="absolute inset-x-1 top-[44%] h-1 rounded bg-white" />
        </>
      )}
      {id === "overlay" && (
        <>
          <div className={cx(face, "inset-0")} />
          <div className="absolute inset-x-1.5 bottom-6 h-4 rounded-sm bg-sky-500 ring-1 ring-white" />
          <div className="absolute inset-x-1 bottom-2 h-1 rounded bg-white" />
        </>
      )}
      {id === "captions" && (
        <>
          <div className={cx(face, "inset-0")} />
          <div className="absolute inset-x-1 bottom-4 h-1.5 rounded bg-white" />
          <div className="absolute left-2 right-3 bottom-2 h-1 rounded bg-yellow-300" />
        </>
      )}
      {id === "motion" && (
        <>
          <div className={cx(face, "inset-0")} />
          <div className="absolute inset-x-1 top-4 h-2 -rotate-3 rounded bg-yellow-300" />
          <div className="absolute left-1 bottom-2 h-2 w-5 rounded-sm bg-black/70" />
          <div className="absolute inset-x-1 bottom-5 h-1 rounded bg-white" />
        </>
      )}
    </div>
  );
}

function CaptionSample({ id }: { id: CaptionStyleId }) {
  const map: Record<CaptionStyleId, React.ReactNode> = {
    bold: (
      <span className="text-sm font-black uppercase text-white" style={{ textShadow: "0 0 3px #000, 0 0 3px #000, 1px 1px 0 #000" }}>
        Bold <span className="text-yellow-300">word</span>
      </span>
    ),
    boxed: (
      <span className="rounded bg-black/80 px-1.5 py-0.5 text-sm font-bold text-white">
        Boxed <span className="text-violet-300">word</span>
      </span>
    ),
    minimal: (
      <span className="text-sm font-semibold text-white" style={{ textShadow: "0 1px 3px rgba(0,0,0,.9)" }}>
        Minimal word
      </span>
    ),
    neon: (
      <span className="text-sm font-black uppercase text-white" style={{ textShadow: "0 0 6px #39ff60" }}>
        Neon <span className="text-[#39ff60]">word</span>
      </span>
    ),
  };
  return <div className="rounded-md bg-neutral-700 px-2 py-1.5">{map[id]}</div>;
}
