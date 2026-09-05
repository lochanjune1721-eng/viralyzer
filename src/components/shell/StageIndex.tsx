"use client";

import Link from "next/link";
import { useApp } from "@/components/shell/AppContext";
import { STAGE_COLORS, STAGE_LABEL, STAGE_META, stageHref } from "@/components/shell/stages";
import { cx, EmptyState, Spinner } from "@/components/ui";
import { STAGE_ORDER, type Stage } from "@/lib/types";
import { IdeationForm } from "@/components/ideation/IdeationForm";

// Shown when a stage is opened without a project: pick one that is at (or past) this stage.
export function StageIndex({ stage }: { stage: Stage }) {
  const { projects, loading } = useApp();
  const meta = STAGE_META.find((s) => s.id === stage)!;
  const here = projects.filter((p) => p.stage === stage);
  const past = projects.filter((p) => STAGE_ORDER[p.stage] > STAGE_ORDER[stage]);
  const before = projects.filter((p) => STAGE_ORDER[p.stage] < STAGE_ORDER[stage]);
  const Icon = meta.icon;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{meta.label}</h1>
          <div className="text-sm text-muted">{meta.blurb}</div>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center p-12"><Spinner /></div>
      ) : (
        <>
          <Section title={`In ${meta.label.toLowerCase()} now`} items={here} stage={stage} />
          {past.length > 0 && <Section title="Already past this stage (revisit)" items={past} stage={stage} />}
          {before.length > 0 && <Section title="Not here yet" items={before} stage={null} />}
          {projects.length === 0 && (
            <div className="mt-8">
              <EmptyState title="No projects yet" body="Start with an idea and it will move through every stage from here." />
              <div className="mt-4"><IdeationForm /></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, items, stage }: { title: string; items: ReturnType<typeof useApp>["projects"]; stage: Stage | null }) {
  if (!items.length) return null;
  return (
    <div className="mt-8">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{title}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((p) => (
          <Link key={p.id} href={stage ? stageHref(stage, p.id) : stageHref(p.stage, p.id)} className="rounded-xl border border-border bg-surface p-3 hover:border-accent/50">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className={cx("h-2 w-2 rounded-full", STAGE_COLORS[p.stage])} />
              {STAGE_LABEL[p.stage]}
            </div>
            <div className="mt-1 line-clamp-2 text-sm font-medium">{p.title}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
