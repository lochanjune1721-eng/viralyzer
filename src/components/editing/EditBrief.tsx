"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Chip, cx } from "@/components/ui";
import { CAPTION_STYLES } from "@/lib/editing/captions";
import type { AspectId, CaptionStyleId, EditBrief as Brief, LayoutId, Project } from "@/lib/types";

const LAYOUTS: Array<{ id: LayoutId; name: string; blurb: string }> = [
  { id: "split-face-bottom", name: "Split: you bottom, visuals top", blurb: "Images of what you're saying above you" },
  { id: "split-face-top", name: "Split: you top, visuals bottom", blurb: "Classic split with images below" },
  { id: "overlay", name: "Full-frame + pop-in visuals", blurb: "You fill the frame, image cards spring in" },
  { id: "motion", name: "Motion graphics", blurb: "Kinetic titles, lower third, progress bar" },
  { id: "captions", name: "Captions only", blurb: "Clean full-frame with word-by-word captions" },
];

const ASPECTS: Array<{ id: AspectId; name: string; hint: string }> = [
  { id: "9:16", name: "9:16", hint: "TikTok · Reels · Shorts" },
  { id: "1:1", name: "1:1", hint: "Feed" },
  { id: "16:9", name: "16:9", hint: "YouTube · LinkedIn" },
];

const DEFAULT: Brief = {
  layout: "split-face-bottom",
  captionStyle: "bold",
  aspect: "9:16",
  removeSilences: true,
  removeFillers: true,
  keepBestTakes: true,
  punchIn: true,
  broll: true,
  titles: true,
  lowerThird: true,
  grade: "auto",
  targetLength: null,
};

// "What kind of edit do you need?" Collected once, then one job does everything.
export function EditBrief({ project, busy, onSubmit }: { project: Project; busy: boolean; onSubmit: (brief: Brief, script: string) => void }) {
  const [brief, setBrief] = useState<Brief>({ ...DEFAULT, ...(project.edit.brief || {}) });
  const [script, setScript] = useState(project.finalScript || "");
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setBrief((b) => ({ ...b, [k]: v }));
  const toggle = (k: keyof Brief) => setBrief((b) => ({ ...b, [k]: !b[k] }));

  return (
    <div className="space-y-5">
      <div>
        <div className="text-lg font-semibold">What kind of edit do you need?</div>
        <div className="text-sm text-muted">Pick a look. Then one pass transcribes, keeps your best takes, cuts silences and fillers, cleans the audio and renders it.</div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Layout</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LAYOUTS.map((l) => (
            <button key={l.id} onClick={() => set("layout", l.id)} className={cx("flex items-center gap-3 rounded-xl border p-3 text-left transition-colors", brief.layout === l.id ? "border-accent bg-accent/5" : "border-border hover:border-fg/30")}>
              <LayoutThumb id={l.id} aspect={brief.aspect} />
              <div>
                <div className="text-sm font-medium">{l.name}</div>
                <div className="text-xs text-muted">{l.blurb}</div>
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
              <button key={a.id} onClick={() => set("aspect", a.id)} className={cx("flex-1 rounded-xl border px-3 py-2 text-sm", brief.aspect === a.id ? "border-accent bg-accent/5" : "border-border hover:border-fg/30")}>
                <div className="font-medium">{a.name}</div>
                <div className="text-[11px] text-muted">{a.hint}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Caption style</div>
          <div className="flex flex-wrap gap-2">
            {CAPTION_STYLES.map((s) => (
              <Chip key={s.id} active={brief.captionStyle === s.id} onClick={() => set("captionStyle", s.id as CaptionStyleId)} title={s.description}>
                {s.name}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">The cut</div>
        <div className="flex flex-wrap gap-2">
          <Chip active={brief.keepBestTakes} onClick={() => toggle("keepBestTakes")}>Keep best take of each line</Chip>
          <Chip active={brief.removeSilences} onClick={() => toggle("removeSilences")}>Remove silences</Chip>
          <Chip active={brief.removeFillers} onClick={() => toggle("removeFillers")}>Remove ums and uhs</Chip>
          <Chip active={brief.punchIn} onClick={() => toggle("punchIn")}>Punch-in zoom at cuts</Chip>
          {(brief.layout.startsWith("split") || brief.layout === "overlay") && <Chip active={brief.broll} onClick={() => toggle("broll")}>Auto images of what you say</Chip>}
          {brief.layout === "motion" && <Chip active={brief.titles} onClick={() => toggle("titles")}>Kinetic titles</Chip>}
          <Chip active={brief.lowerThird} onClick={() => toggle("lowerThird")}>Lower third with your name</Chip>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Target length</div>
        <div className="flex flex-wrap gap-2">
          {[null, 15, 30, 60, 90].map((n) => (
            <Chip key={String(n)} active={brief.targetLength === n} onClick={() => set("targetLength", n)}>
              {n ? `${n}s` : "As recorded"}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">The script you read {project.finalScript ? "" : "(optional, but it makes the cut much sharper)"}</div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={script ? 5 : 3}
          placeholder="Paste it line by line. Everything you said that isn't here (restarts, mumbles, 'wait, again') gets cut."
          className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted">You can change any of this afterwards and re-render.</div>
        <Button variant="primary" size="lg" loading={busy} onClick={() => onSubmit(brief, script)}>
          <Sparkles className="h-4 w-4" /> Make my edit
        </Button>
      </div>
    </div>
  );
}

function LayoutThumb({ id, aspect }: { id: LayoutId; aspect: AspectId }) {
  const portrait = aspect !== "16:9";
  const box = portrait ? "h-16 w-9" : "h-9 w-16";
  const face = "absolute bg-[#d0a58a]";
  const img = "absolute bg-sky-500/80";
  return (
    <div className={cx("relative shrink-0 overflow-hidden rounded-md bg-neutral-800", box)}>
      {id === "split-face-bottom" && (
        <>
          <div className={cx(img, portrait ? "inset-x-0 top-0 h-1/2" : "inset-y-0 left-0 w-1/2")} />
          <div className={cx(face, portrait ? "inset-x-0 bottom-0 h-1/2" : "inset-y-0 right-0 w-1/2")} />
        </>
      )}
      {id === "split-face-top" && (
        <>
          <div className={cx(face, portrait ? "inset-x-0 top-0 h-1/2" : "inset-y-0 left-0 w-1/2")} />
          <div className={cx(img, portrait ? "inset-x-0 bottom-0 h-1/2" : "inset-y-0 right-0 w-1/2")} />
        </>
      )}
      {id === "overlay" && (
        <>
          <div className={cx(face, "inset-0")} />
          <div className="absolute inset-x-1.5 bottom-5 h-4 rounded-sm bg-sky-500 ring-1 ring-white" />
        </>
      )}
      {id === "captions" && (
        <>
          <div className={cx(face, "inset-0")} />
          <div className="absolute inset-x-1 bottom-3 h-1.5 rounded bg-white" />
        </>
      )}
      {id === "motion" && (
        <>
          <div className={cx(face, "inset-0")} />
          <div className="absolute inset-x-1 top-3 h-2 -rotate-3 rounded bg-yellow-300" />
          <div className="absolute left-1 bottom-2 h-2 w-5 rounded-sm bg-black/70" />
        </>
      )}
    </div>
  );
}
