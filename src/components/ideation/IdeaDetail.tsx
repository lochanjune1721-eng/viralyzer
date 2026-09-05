"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button, Card, Spinner, useToast } from "@/components/ui";
import { useApp, useProject } from "@/components/shell/AppContext";
import type { Project } from "@/lib/types";

export function IdeaDetail({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { refreshProjects } = useApp();
  const { project, setProject, error } = useProject(id);
  const [idea, setIdea] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (project && project.id !== loadedId) {
    setLoadedId(project.id);
    setIdea(project.idea);
    setReference(project.reference || "");
  }

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!project) return <div className="flex justify-center p-12"><Spinner /></div>;

  async function save(): Promise<Project> {
    const res = await api<{ project: Project }>(`/api/projects/${id}`, { method: "PATCH", body: { idea, reference } });
    setProject(res.project);
    return res.project;
  }

  async function scriptThis() {
    setBusy(true);
    try {
      await save();
      const res = await api<{ project: Project }>(`/api/projects/${id}`, { method: "PATCH", body: { stage: project!.stage === "ideation" ? "scripting" : project!.stage } });
      setProject(res.project);
      router.push(`/scripting/${id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this project and all its footage?")) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    await refreshProjects();
    router.push("/");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">Ideation</div>
      <h1 className="text-xl font-semibold">{project.title}</h1>
      <Card className="mt-5 p-4">
        <label className="text-xs font-medium text-muted">Idea</label>
        <textarea value={idea} onChange={(e) => setIdea(e.target.value)} onBlur={() => save().catch(() => {})} rows={4} className="mt-1 w-full resize-none rounded-xl bg-surface-2 p-3 text-base outline-none" />
        <label className="mt-4 block text-xs font-medium text-muted">Reference (optional)</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          onBlur={() => save().catch(() => {})}
          placeholder="Link, headline, tweet…"
          className="mt-1 w-full rounded-xl bg-surface-2 p-3 text-sm outline-none"
        />
      </Card>
      <div className="mt-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={remove} className="text-danger">
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        <Button variant="primary" size="lg" onClick={scriptThis} loading={busy}>
          {project.scripts.length ? "Open scripting" : "Script this"} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
