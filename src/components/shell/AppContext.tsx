"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import type { Project, User } from "@/lib/types";

export interface Capabilities {
  llm: string;
  transcription: string;
  publishProvider: string;
}

interface AppState {
  me: User | null;
  niches: readonly string[];
  capabilities: Capabilities | null;
  projects: Project[];
  loading: boolean;
  refreshMe: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  upsertProject: (p: Project) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<User | null>(null);
  const [niches, setNiches] = useState<readonly string[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    const data = await api<{ user: User; niches: string[]; capabilities: Capabilities }>("/api/me");
    setMe(data.user);
    setNiches(data.niches);
    setCapabilities(data.capabilities);
  }, []);

  const refreshProjects = useCallback(async () => {
    const data = await api<{ projects: Project[] }>("/api/projects");
    setProjects(data.projects);
  }, []);

  const upsertProject = useCallback((p: Project) => {
    setProjects((list) => {
      const rest = list.filter((x) => x.id !== p.id);
      return [p, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  useEffect(() => {
    Promise.all([refreshMe(), refreshProjects()])
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [refreshMe, refreshProjects]);

  const value = useMemo(
    () => ({ me, niches, capabilities, projects, loading, refreshMe, refreshProjects, upsertProject }),
    [me, niches, capabilities, projects, loading, refreshMe, refreshProjects, upsertProject],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** Load one project and keep it in sync with the sidebar list. */
export function useProject(id: string) {
  const { upsertProject } = useApp();
  const [project, setProjectState] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setProject = useCallback(
    (p: Project) => {
      setProjectState(p);
      upsertProject(p);
    },
    [upsertProject],
  );
  const reload = useCallback(async () => {
    try {
      const data = await api<{ project: Project }>(`/api/projects/${id}`);
      setProject(data.project);
      setError(null);
      return data.project;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [id, setProject]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { project, setProject, reload, error };
}
