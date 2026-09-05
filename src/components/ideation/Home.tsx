"use client";

import Link from "next/link";
import { useApp } from "@/components/shell/AppContext";
import { STAGE_COLORS, STAGE_LABEL, STAGE_META, stageHref } from "@/components/shell/stages";
import { cx } from "@/components/ui";
import { IdeationForm } from "./IdeationForm";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function Home() {
  const { me, projects, capabilities } = useApp();
  const recent = projects.slice(0, 6);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:py-16">
      <div className="mb-6 text-center">
        <div className="text-2xl font-semibold tracking-tight md:text-3xl">
          {greeting()}
          {me?.name ? `, ${me.name.split(" ")[0]}` : ""}
        </div>
        <div className="mt-1 text-muted">What are we making today{me?.niche ? ` for ${me.niche}` : ""}?</div>
      </div>
      <IdeationForm autoFocus />
      {capabilities && capabilities.llm === "mock" && (
        <div className="mt-3 text-center text-xs text-muted">
          No DeepSeek key configured, so scripts will be placeholder drafts. Set <code>DEEPSEEK_API_KEY</code> to generate real ones.
        </div>
      )}

      <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-5">
        {STAGE_META.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4 text-accent" />
                {i + 1}. {s.label}
              </div>
              <div className="mt-1 text-xs text-muted">{s.blurb}</div>
            </div>
          );
        })}
      </div>

      {recent.length > 0 && (
        <div className="mt-10">
          <div className="mb-3 text-sm font-medium text-muted">Pick up where you left off</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recent.map((p) => (
              <Link key={p.id} href={stageHref(p.stage, p.id)} className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/50">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className={cx("h-2 w-2 rounded-full", STAGE_COLORS[p.stage])} />
                  {STAGE_LABEL[p.stage]}
                </div>
                <div className="mt-1 line-clamp-2 font-medium">{p.title}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
