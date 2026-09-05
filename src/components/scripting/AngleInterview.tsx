"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Chip } from "@/components/ui";
import type { Angle, Audience, TargetLength, Take, Tone } from "@/lib/types";

const TAKES: Array<{ id: Take; label: string }> = [
  { id: "explainer", label: "Explainer" },
  { id: "hot_take", label: "Hot take" },
  { id: "contrarian", label: "Contrarian" },
  { id: "news_reaction", label: "News reaction" },
  { id: "tutorial", label: "Tutorial" },
  { id: "story", label: "Story" },
];
const TONES: Array<{ id: Tone; label: string }> = [
  { id: "serious", label: "Serious" },
  { id: "funny", label: "Funny" },
  { id: "hype", label: "Hype" },
  { id: "skeptical", label: "Skeptical" },
];
const AUDIENCES: Array<{ id: Audience; label: string }> = [
  { id: "beginners", label: "Beginners" },
  { id: "insiders", label: "Already in the niche" },
];
const LENGTHS: TargetLength[] = [15, 30, 60, 90];

export function AngleInterview({
  initial,
  onGenerate,
  busy,
  hasScripts,
}: {
  initial: Angle;
  onGenerate: (angle: Angle) => Promise<void>;
  busy: boolean;
  hasScripts: boolean;
}) {
  const [angle, setAngle] = useState<Angle>({ length: 60, ...initial });
  const set = <K extends keyof Angle>(k: K, v: Angle[K]) => setAngle((a) => ({ ...a, [k]: a[k] === v ? undefined : v }));

  return (
    <div className="space-y-5">
      <Question label="What's the take?">
        {TAKES.map((t) => (
          <Chip key={t.id} active={angle.take === t.id} onClick={() => set("take", t.id)}>
            {t.label}
          </Chip>
        ))}
      </Question>
      <Question label="Controversial or safe?">
        <Chip active={angle.controversy === "controversial"} onClick={() => set("controversy", "controversial")}>
          Controversial
        </Chip>
        <Chip active={angle.controversy === "safe"} onClick={() => set("controversy", "safe")}>
          Safe
        </Chip>
      </Question>
      <Question label="Tone">
        {TONES.map((t) => (
          <Chip key={t.id} active={angle.tone === t.id} onClick={() => set("tone", t.id)}>
            {t.label}
          </Chip>
        ))}
      </Question>
      <Question label="Who's it for?">
        {AUDIENCES.map((t) => (
          <Chip key={t.id} active={angle.audience === t.id} onClick={() => set("audience", t.id)}>
            {t.label}
          </Chip>
        ))}
      </Question>
      <Question label="Target length">
        {LENGTHS.map((l) => (
          <Chip key={l} active={angle.length === l} onClick={() => setAngle((a) => ({ ...a, length: l }))}>
            {l}s
          </Chip>
        ))}
      </Question>
      <div>
        <div className="mb-1.5 text-sm font-medium">Or write the exact angle</div>
        <textarea
          value={angle.custom || ""}
          onChange={(e) => setAngle((a) => ({ ...a, custom: e.target.value }))}
          rows={2}
          placeholder='e.g. "why this matters less than the model nobody is talking about"'
          className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="lg" loading={busy} onClick={() => onGenerate(angle)}>
          <Sparkles className="h-4 w-4" /> {hasScripts ? "Regenerate 3 scripts" : "Generate 3 scripts"}
        </Button>
      </div>
    </div>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
