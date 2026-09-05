"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button, Chip, useToast } from "@/components/ui";
import { useApp } from "@/components/shell/AppContext";
import type { User } from "@/lib/types";

export function Onboarding() {
  const router = useRouter();
  const toast = useToast();
  const { me, niches, refreshMe, capabilities } = useApp();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (me && niches.length && me.id !== loadedFor) {
    setLoadedFor(me.id);
    setName(me.name === "Creator" ? "" : me.name);
    setHandle(me.handle || "");
    if (me.niche) {
      if (niches.includes(me.niche)) setNiche(me.niche);
      else {
        setNiche("other");
        setCustom(me.niche);
      }
    }
  }

  async function save() {
    const finalNiche = niche === "other" ? custom.trim().toLowerCase() : niche;
    if (!finalNiche) return toast.push("Pick your niche so scripts and visuals fit your audience.", "error");
    setBusy(true);
    try {
      await api<{ user: User }>("/api/me", { method: "PATCH", body: { name: name.trim() || "Creator", handle: handle.trim() || null, niche: finalNiche } });
      await refreshMe();
      toast.push("Profile saved", "success");
      router.push("/");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 md:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{me?.niche ? "Your profile" : "Welcome. Let's set you up."}</h1>
      <p className="mt-1 text-muted">Your niche shapes every script, visual and caption the app writes for you.</p>

      <label className="mt-8 block text-sm font-medium">Your name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent" />

      <label className="mt-4 block text-sm font-medium">Handle (shown in lower thirds)</label>
      <div className="mt-1 flex items-center rounded-xl border border-border bg-surface px-3 focus-within:border-accent">
        <span className="text-muted">@</span>
        <input value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))} placeholder="yourhandle" className="w-full bg-transparent py-2.5 pl-1 outline-none" />
      </div>

      <label className="mt-6 block text-sm font-medium">Your niche</label>
      <div className="mt-2 flex flex-wrap gap-2">
        {niches.map((n) => (
          <Chip key={n} active={niche === n} onClick={() => setNiche(n)}>
            {n}
          </Chip>
        ))}
      </div>
      {niche === "other" && (
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Describe your niche, e.g. 'indie game dev'" className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent" />
      )}

      <div className="mt-8 flex justify-end">
        <Button variant="primary" size="lg" onClick={save} loading={busy}>
          {me?.niche ? "Save" : "Start creating"}
        </Button>
      </div>

      {capabilities && (
        <div className="mt-10 rounded-xl border border-border bg-surface p-4 text-xs text-muted">
          <div className="font-medium text-fg">Server capabilities</div>
          <div className="mt-1">Scripts: {capabilities.llm === "mock" ? "placeholder mode (no DEEPSEEK_API_KEY)" : "DeepSeek"}</div>
          <div>Transcription: {capabilities.transcription === "mock" ? "script alignment (no speech-to-text key)" : capabilities.transcription}</div>
          <div>Publishing: {capabilities.publishProvider}</div>
        </div>
      )}
    </div>
  );
}
