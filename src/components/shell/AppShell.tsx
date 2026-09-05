"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Plus, Settings, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "./AppContext";
import { STAGE_COLORS, STAGE_LABEL, STAGE_META, stageHref } from "./stages";
import { cx } from "@/components/ui";
import type { Project } from "@/lib/types";

export const APP_NAME = "Viralyzer";

function useCurrentProjectId(): string | null {
  const pathname = usePathname();
  const m = /^\/(ideation|scripting|shooting|editing|uploading)\/([^/]+)/.exec(pathname || "");
  return m ? m[2] : null;
}

function useActiveStage(): string | null {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/ideation")) return "ideation";
  const m = /^\/(scripting|shooting|editing|uploading)/.exec(pathname || "");
  return m ? m[1] : null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);

  // First run: collect name + niche before anything else.
  useEffect(() => {
    if (!loading && me && !me.niche && pathname !== "/onboarding") router.replace("/onboarding");
  }, [loading, me, pathname, router]);

  const [drawerPath, setDrawerPath] = useState(pathname);
  if (pathname !== drawerPath) {
    setDrawerPath(pathname);
    setDrawer(false);
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface/95 px-3 backdrop-blur md:hidden">
        <Link href="/" className="text-base font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <button className="rounded-lg p-2 text-muted hover:bg-surface-2" onClick={() => setDrawer(true)} aria-label="Open projects">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="text-base font-semibold">{APP_NAME}</span>
              <button className="rounded-lg p-2 text-muted" onClick={() => setDrawer(false)} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent compact />
          </div>
        </div>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto pt-12 pb-16 md:pt-0 md:pb-0">{children}</main>

      <MobileTabBar />
    </div>
  );
}

function SidebarContent({ compact }: { compact?: boolean }) {
  const { me, projects } = useApp();
  const currentId = useCurrentProjectId();
  const active = useActiveStage();
  const current = projects.find((p) => p.id === currentId) || null;
  return (
    <div className="flex h-full flex-col">
      {!compact && (
        <div className="px-4 pt-5 pb-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="brand-gradient inline-block h-6 w-6 rounded-lg shadow-md" />
            {APP_NAME}
          </Link>
          <div className="mt-0.5 text-xs text-muted">Idea → published, in one place</div>
        </div>
      )}
      <nav className="px-2 pt-2">
        {STAGE_META.map((s) => {
          const Icon = s.icon;
          const href = stageHref(s.id, currentId);
          const isActive = active === s.id;
          const reached = current ? stageIndex(current.stage) >= stageIndex(s.id) : false;
          return (
            <Link
              key={s.id}
              href={href}
              className={cx(
                "group flex items-center gap-3 rounded-xl px-2.5 py-1.5 text-sm transition-colors",
                isActive ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <span
                className={cx("flex h-7 w-7 items-center justify-center rounded-lg transition-transform group-hover:scale-110", isActive ? "text-white shadow-md" : "bg-surface-2 text-muted group-hover:text-fg")}
                style={isActive ? { background: s.color } : undefined}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1">{s.label}</span>
              {current && reached && <span className={cx("h-1.5 w-1.5 rounded-full", STAGE_COLORS[current.stage === "published" ? "published" : s.id])} />}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 pt-4">
        <Link href="/" className="lift flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg">
          <Plus className="h-4 w-4" /> New idea
        </Link>
      </div>
      <div className="mt-4 px-4 text-[11px] font-medium uppercase tracking-wider text-muted">Recent projects</div>
      <div className="scrollbar-thin mt-1 flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 && <div className="px-3 py-2 text-xs text-muted">Nothing yet. Start with an idea.</div>}
        {projects.slice(0, 40).map((p) => (
          <ProjectRow key={p.id} project={p} active={p.id === currentId} />
        ))}
      </div>
      <div className="border-t border-border p-3">
        <Link href="/onboarding" className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-surface-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            {(me?.name || "C").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{me?.name || "Creator"}</div>
            <div className="truncate text-xs text-muted">{me?.niche ? `${me.niche} niche` : "Set your niche"}</div>
          </div>
          <Settings className="h-4 w-4 text-muted" />
        </Link>
      </div>
    </div>
  );
}

function ProjectRow({ project, active }: { project: Project; active: boolean }) {
  return (
    <Link
      href={stageHref(project.stage, project.id)}
      className={cx("flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm", active ? "bg-surface-2" : "hover:bg-surface-2")}
      title={`${project.title} · ${STAGE_LABEL[project.stage]}`}
    >
      <span className={cx("h-2 w-2 shrink-0 rounded-full", STAGE_COLORS[project.stage])} />
      <span className="min-w-0 flex-1 truncate">{project.title}</span>
      <span className="shrink-0 text-[10px] text-muted">{STAGE_LABEL[project.stage]}</span>
    </Link>
  );
}

function MobileTabBar() {
  const currentId = useCurrentProjectId();
  const active = useActiveStage();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      {STAGE_META.map((s) => {
        const Icon = s.icon;
        const isActive = active === s.id;
        return (
          <Link key={s.id} href={stageHref(s.id, currentId)} className={cx("flex h-14 flex-col items-center justify-center gap-1 text-[10px]", isActive ? "text-fg" : "text-muted")} style={isActive ? { color: s.color } : undefined}>
            <span className={cx("flex h-7 w-9 items-center justify-center rounded-full transition-colors")} style={isActive ? { background: `color-mix(in srgb, ${s.color} 18%, transparent)` } : undefined}>
              <Icon className="h-5 w-5" />
            </span>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

function stageIndex(stage: string): number {
  return ["ideation", "scripting", "shooting", "editing", "uploading", "published"].indexOf(stage);
}
