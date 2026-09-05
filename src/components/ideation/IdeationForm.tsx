"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Link2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button, useToast } from "@/components/ui";
import { useApp } from "@/components/shell/AppContext";
import type { Project } from "@/lib/types";

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

export function IdeationForm({ autoFocus, seed }: { autoFocus?: boolean; seed?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { upsertProject } = useApp();
  const [idea, setIdea] = useState("");
  const [reference, setReference] = useState("");
  const [showRef, setShowRef] = useState(false);
  const [busy, setBusy] = useState(false);
  // A suggestion chip fills the box (seed carries a unique suffix so repeats re-apply).
  const [appliedSeed, setAppliedSeed] = useState<string | undefined>(undefined);
  if (seed && seed !== appliedSeed) {
    setAppliedSeed(seed);
    setIdea(seed.split("\u200b")[0]);
  }

  async function submit(scriptIt: boolean) {
    let ideaText = idea.trim();
    let ref = reference.trim();
    // A pasted link in the idea box is a reference, not an idea.
    if (!ref && URL_RE.test(ideaText)) {
      ref = ideaText;
      ideaText = "";
    }
    if (!ideaText && !ref) return toast.push("Type an idea or paste a reference first.", "error");
    setBusy(true);
    try {
      const { project } = await api<{ project: Project }>("/api/projects", { method: "POST", body: { idea: ideaText, reference: ref } });
      upsertProject(project);
      if (scriptIt) {
        const res = await api<{ project: Project }>(`/api/projects/${project.id}`, { method: "PATCH", body: { stage: "scripting" } });
        upsertProject(res.project);
        router.push(`/scripting/${project.id}`);
      } else {
        router.push(`/ideation/${project.id}`);
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/95 p-3 shadow-lg shadow-black/5 backdrop-blur transition-shadow focus-within:border-accent focus-within:shadow-[0_18px_40px_-20px_var(--accent)]">
      <textarea
        autoFocus={autoFocus}
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(true);
        }}
        rows={3}
        placeholder="What's the video about? Type an idea, a take, or paste a link, headline or tweet…"
        className="w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-muted"
      />
      {showRef && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
          <Link2 className="h-4 w-4 text-muted" />
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Reference: link to a post/video, news headline, tweet…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setShowRef((v) => !v)}>
          {showRef ? "Hide reference" : "+ Add a reference"}
        </button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => submit(false)} disabled={busy}>
            Save idea
          </Button>
          <Button variant="primary" onClick={() => submit(true)} loading={busy}>
            Script this <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
