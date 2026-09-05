"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button, useToast } from "@/components/ui";
import { useApp } from "@/components/shell/AppContext";
import type { Project } from "@/lib/types";

export function SampleProjectButton({ label = "Try a sample project", size = "md", variant = "secondary" }: { label?: string; size?: "sm" | "md" | "lg"; variant?: "primary" | "secondary" | "ghost" }) {
  const router = useRouter();
  const toast = useToast();
  const { upsertProject } = useApp();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const { project } = await api<{ project: Project }>("/api/projects/sample", { method: "POST" });
      upsertProject(project);
      router.push(`/scripting/${project.id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }
  return (
    <Button variant={variant} size={size} onClick={go} loading={busy}>
      <Sparkles className="h-4 w-4" /> {label}
    </Button>
  );
}
