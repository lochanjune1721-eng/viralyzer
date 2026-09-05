"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { STAGE_META, stageHref } from "./stages";
import type { Project, Stage } from "@/lib/types";
import { STAGE_ORDER } from "@/lib/types";
import { cx } from "@/components/ui";

export function StageHeader({ stage, project, right }: { stage: Stage; project: Project; right?: React.ReactNode }) {
  const idx = STAGE_META.findIndex((s) => s.id === stage);
  const prev = STAGE_META[idx - 1];
  const next = STAGE_META[idx + 1];
  const canGoNext = next && STAGE_ORDER[project.stage] >= STAGE_ORDER[next.id];
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
          {prev ? (
            <Link href={stageHref(prev.id, project.id)} className="flex items-center gap-0.5 hover:text-fg">
              <ChevronLeft className="h-3.5 w-3.5" /> {prev.label}
            </Link>
          ) : null}
          <span className="rounded-full px-2 py-0.5 text-white" style={{ background: STAGE_META[idx].color }}>
            {STAGE_META[idx].label}
          </span>
          {next && canGoNext ? (
            <Link href={stageHref(next.id, project.id)} className="flex items-center gap-0.5 hover:text-fg">
              · {next.label} <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
        <h1 className="truncate text-xl font-semibold">{project.title}</h1>
      </div>
      {right}
    </div>
  );
}
