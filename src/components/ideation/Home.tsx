"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/shell/AppContext";
import { STAGE_COLORS, STAGE_LABEL, STAGE_META, stageHref } from "@/components/shell/stages";
import { SampleProjectButton } from "@/components/shell/SampleProjectButton";
import { cx } from "@/components/ui";
import { IdeationForm } from "./IdeationForm";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night grind";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const PROMPTS: Record<string, string[]> = {
  default: ["Hot take: the advice everyone gives that quietly fails", "React to this week's biggest headline", "Explain one thing beginners always get wrong", "The tool I stopped using and why"],
  tech: ["GPT-6 launched and everyone is wrong about it", "The iPhone feature nobody asked for", "Why this startup's pivot actually makes sense", "One AI tool that replaced three apps for me"],
  fitness: ["Your 5am workout is sabotaging your progress", "Protein timing: what the studies actually say", "The stretch everyone skips", "30 days without cardio, here's what happened"],
  finance: ["The 50/30/20 rule is broken in 2026", "What an emergency fund should really cover", "Why I stopped chasing dividends", "Rent vs buy in one chart"],
  politics: ["The vote that matters more than this week's debate", "Follow the money on today's headline", "What the new bill actually changes", "Three things the coverage got wrong"],
  marketing: ["Hooks are overrated, retention wins", "The CTA that doubled my replies", "Why your carousel dies on slide 2", "Copy the ad, not the brand"],
};

export function Home() {
  const { me, projects, capabilities } = useApp();
  const [seed, setSeed] = useState<string | undefined>(undefined);
  const recent = projects.slice(0, 4);
  const prompts = PROMPTS[me?.niche || ""] || PROMPTS.default;
  const first = me?.name ? me.name.split(" ")[0] : "";

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center px-4 py-10 md:py-12">
      <div className="blob-field" aria-hidden>
        <div className="blob left-[8%] top-[8%] h-72 w-72" style={{ background: "#f2b544" }} />
        <div className="blob right-[10%] top-[22%] h-80 w-80" style={{ background: "#ef5b8a", animationDelay: "-6s" }} />
        <div className="blob bottom-[8%] left-[35%] h-72 w-72" style={{ background: "#5b8def", animationDelay: "-12s" }} />
      </div>

      <div className="relative z-10 w-full max-w-3xl">
        <div className="stagger text-center">
          <div className="text-3xl font-semibold tracking-tight md:text-5xl">
            <span className="wave">👋</span> {greeting()}
            {first ? (
              <>
                , <span className="text-gradient">{first}</span>
              </>
            ) : null}
          </div>
          <div className="mt-3 text-base text-muted md:text-lg">
            What are we making today{me?.niche ? ` for ${me.niche}` : ""}? Idea in, published post out.
          </div>
        </div>

        <div className="mt-8">
          <IdeationForm autoFocus seed={seed} />
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {prompts.map((p) => (
            <button
              key={p}
              onClick={() => setSeed(p + "​" + Date.now())}
              className="rounded-full border border-border bg-surface/80 px-3 py-1.5 text-xs text-muted backdrop-blur transition-all hover:-translate-y-0.5 hover:border-accent hover:text-fg"
            >
              ✨ {p}
            </button>
          ))}
        </div>

        {capabilities && capabilities.llm === "mock" && (
          <div className="mt-4 text-center text-xs text-muted">
            No DeepSeek key configured, so scripts will be placeholder drafts. Set <code>DEEPSEEK_API_KEY</code> to generate real ones.
          </div>
        )}

        <div className="stagger mt-10 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {STAGE_META.map((s, i) => {
            const Icon = s.icon;
            return (
              <Link key={s.id} href={stageHref(s.id)} className="lift group rounded-2xl border border-border bg-surface p-3.5" style={{ borderColor: `color-mix(in srgb, ${s.color} 35%, var(--border))` }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-md transition-transform group-hover:scale-110 group-hover:rotate-3" style={{ background: s.color }}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-2.5 text-sm font-semibold">
                  {i + 1}. {s.label}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-muted">{s.blurb}</div>
              </Link>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col items-center gap-2 text-center">
          <div className="text-xs text-muted">New here? Skip the typing and explore every stage with a ready-made project.</div>
          <SampleProjectButton label="Try a sample project" />
        </div>

        {recent.length > 0 && (
          <div className="mt-10">
            <div className="mb-3 text-center text-sm font-medium text-muted">Pick up where you left off</div>
            <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recent.map((p) => (
                <Link key={p.id} href={stageHref(p.stage, p.id)} className="lift rounded-2xl border border-border bg-surface p-4">
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
    </div>
  );
}
