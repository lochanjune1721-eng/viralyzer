"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useApp } from "@/components/shell/AppContext";
import { STAGE_COLORS, STAGE_LABEL, STAGE_META, stageHref } from "@/components/shell/stages";
import { SampleProjectButton } from "@/components/shell/SampleProjectButton";
import { StagePreview } from "@/components/shell/StagePreview";
import { cx, Spinner } from "@/components/ui";
import { STAGE_ORDER, type Stage } from "@/lib/types";
import { IdeationForm } from "@/components/ideation/IdeationForm";
import { ShootingStudio } from "@/components/shooting/ShootingStudio";
import { VideoImport } from "@/components/shared/VideoImport";
import { VideoUnavailableBanner } from "@/components/shell/VideoUnavailableBanner";

// A stage opened without a project: show what the workspace does, let the
// user jump into a project that is at (or past) this stage, or start one.
export function StageIndex({ stage }: { stage: Stage }) {
  const { projects, loading } = useApp();
  const meta = STAGE_META.find((s) => s.id === stage)!;
  const here = projects.filter((p) => p.stage === stage);
  const past = projects.filter((p) => STAGE_ORDER[p.stage] > STAGE_ORDER[stage]);
  const before = projects.filter((p) => STAGE_ORDER[p.stage] < STAGE_ORDER[stage]);
  const Icon = meta.icon;
  const idx = STAGE_META.findIndex((s) => s.id === stage);

  return (
    <div className="relative">
      <div className="blob-field" aria-hidden>
        <div className="blob left-[5%] top-[-5%] h-72 w-72" style={{ background: meta.color }} />
        <div className="blob right-[5%] top-[30%] h-64 w-64" style={{ background: meta.color, animationDelay: "-9s", opacity: 0.25 }} />
      </div>
      <div className={cx("relative z-10 mx-auto w-full px-4 py-8 md:py-12", stage === "shooting" ? "max-w-6xl" : "max-w-4xl")}>
        {/* stepper */}
        <div className="mb-8 flex items-center gap-1.5 overflow-x-auto text-xs">
          {STAGE_META.map((s, i) => (
            <Link key={s.id} href={stageHref(s.id)} className="flex shrink-0 items-center gap-1.5">
              <span
                className={cx("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white transition-transform hover:scale-110", i > idx && "opacity-40")}
                style={{ background: s.color }}
              >
                {i < idx ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={cx(i === idx ? "font-medium text-fg" : "text-muted")}>{s.label}</span>
              {i < STAGE_META.length - 1 && <span className="mx-1 h-px w-5 bg-border" />}
            </Link>
          ))}
        </div>

        {(stage === "shooting" || stage === "editing" || stage === "uploading") && <VideoUnavailableBanner />}
        {/* The stage's tool, usable on its own */}
        {stage === "shooting" && (
          <div className="mb-10">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {meta.emoji} Teleprompter studio
            </h1>
            <p className="mb-4 mt-1 text-sm text-muted">Paste any script and record, no project needed. Change how the text comes in, drag it anywhere, set the pace.</p>
            <ShootingStudio />
          </div>
        )}
        {stage === "editing" && (
          <div className="mb-10">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {meta.emoji} Bring your own footage
            </h1>
            <p className="mb-4 mt-1 text-sm text-muted">Upload a raw take from any camera, paste the script you read, and we cut it down: best take of every line, no ums, no dead air.</p>
            <VideoImport target="editing" accent={meta.color} />
          </div>
        )}
        {stage === "uploading" && (
          <div className="mb-10">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {meta.emoji} Post a finished video
            </h1>
            <p className="mb-4 mt-1 text-sm text-muted">Already edited elsewhere? Drop the file, draft the caption, and post to every connected platform at once.</p>
            <VideoImport target="uploading" accent={meta.color} />
          </div>
        )}
        {stage === "scripting" && (
          <div className="mb-10">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {meta.emoji} Write a script from any idea
            </h1>
            <p className="mb-4 mt-1 text-sm text-muted">Type the topic, pick an angle on the next screen, and get three scripts with different hooks.</p>
            <IdeationForm />
          </div>
        )}

        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
          <div className="stagger">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: meta.color }}>
              <Icon className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">{meta.headline}</h2>
            <p className="mt-2 text-muted">
              Stage {idx + 1} of 5 · {meta.blurb}
            </p>
            <ul className="mt-5 space-y-2.5">
              {meta.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white" style={{ background: meta.color }}>
                    <Check className="h-2.5 w-2.5" />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
              <SampleProjectButton label="Open a sample project here" variant="primary" />
              <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
                Start from an idea <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="fade-up">
            <StagePreview stage={stage} />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center p-12">
            <Spinner />
          </div>
        ) : (
          <div className="mt-12">
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-6">
                <div className="mb-3 text-sm font-medium">This workspace opens once a project reaches {meta.label.toLowerCase()}. Drop an idea to start one:</div>
                <IdeationForm />
              </div>
            ) : (
              <>
                <Section title={`Open in ${meta.label.toLowerCase()}`} items={here} stage={stage} accent={meta.color} />
                {past.length > 0 && <Section title="Already past this stage (revisit)" items={past} stage={stage} accent={meta.color} />}
                {before.length > 0 && <Section title={`Not at ${meta.label.toLowerCase()} yet (continue where they are)`} items={before} stage={null} accent={meta.color} />}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, items, stage, accent }: { title: string; items: ReturnType<typeof useApp>["projects"]; stage: Stage | null; accent: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{title}</div>
      <div className="stagger grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((p) => (
          <Link
            key={p.id}
            href={stage ? stageHref(stage, p.id) : stageHref(p.stage, p.id)}
            className="lift flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
            style={{ borderColor: stage ? `color-mix(in srgb, ${accent} 40%, var(--border))` : undefined }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className={cx("h-2 w-2 rounded-full", STAGE_COLORS[p.stage])} />
                {STAGE_LABEL[p.stage]}
              </div>
              <div className="mt-0.5 line-clamp-2 text-sm font-medium">{p.title}</div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </div>
  );
}
