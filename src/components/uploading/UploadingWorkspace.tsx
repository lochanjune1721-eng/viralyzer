"use client";

import { useSearchParams } from "next/navigation";
import { CalendarClock, ExternalLink, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, mediaUrl } from "@/lib/api-client";
import { Badge, Button, Card, Spinner, cx, useToast } from "@/components/ui";
import { useProject } from "@/components/shell/AppContext";
import { StageHeader } from "@/components/shell/StageHeader";
import type { PlatformStatus } from "@/lib/publish";
import type { Platform, Project, Publication, PublishState } from "@/lib/types";
import { ConnectAccounts, PLATFORM_ICON } from "./ConnectAccounts";

export function UploadingWorkspace({ id }: { id: string }) {
  const toast = useToast();
  const search = useSearchParams();
  const { project, setProject, reload, error } = useProject(id);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selected, setSelected] = useState<Platform[]>([]);
  const [schedule, setSchedule] = useState(false);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const seeded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPublish = useCallback(async () => {
    const data = await api<{ publications: Publication[]; platforms: PlatformStatus[]; publish: PublishState }>(`/api/projects/${id}/publish`);
    setPublications(data.publications);
    setPlatforms(data.platforms);
    return data;
  }, [id]);

  useEffect(() => {
    loadPublish().catch((err) => toast.push(err.message, "error"));
  }, [loadPublish, toast]);

  // OAuth callback lands here with ?connect=platform&ok=... or &error=...
  useEffect(() => {
    const c = search.get("connect");
    if (!c) return;
    const ok = search.get("ok");
    const err = search.get("error");
    if (ok) toast.push(`${c} connected${ok !== "connected" ? ` as ${ok}` : ""}`, "success");
    if (err) toast.push(`${c}: ${err}`, "error");
    window.history.replaceState(null, "", window.location.pathname);
  }, [search, toast]);

  // Seed the form from saved state, or draft a caption from the script.
  useEffect(() => {
    if (!project || seeded.current || platforms.length === 0) return;
    seeded.current = true;
    const p = project.publish;
    setCaption(p.caption || "");
    setTitle(p.title || project.title);
    setHashtags(p.hashtags || []);
    const connected = platforms.filter((x) => x.connected).map((x) => x.platform);
    setSelected(p.selected?.length ? p.selected.filter((x) => connected.includes(x)) : connected);
    if (p.scheduledAt) {
      setSchedule(true);
      setWhen(toLocalInput(p.scheduledAt));
    }
    if (!p.caption) draftCaption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, platforms]);

  // Poll while an imported video is still being prepared.
  const renderRunning = project?.edit.render?.status === "running";
  useEffect(() => {
    if (!renderRunning) return;
    const t = setInterval(() => reload(), 2000);
    return () => clearInterval(t);
  }, [renderRunning, reload]);

  // Poll while something is publishing.
  useEffect(() => {
    if (!publications.some((p) => p.status === "publishing")) return;
    const t = setInterval(() => loadPublish().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [publications, loadPublish]);

  async function draftCaption() {
    setDrafting(true);
    try {
      const res = await api<{ publish: PublishState }>(`/api/projects/${id}/publish/caption`, { method: "POST" });
      setCaption(res.publish.caption || "");
      setHashtags(res.publish.hashtags || []);
      setTitle(res.publish.title || title);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDrafting(false);
    }
  }

  function persistDraft(next: Partial<PublishState>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api(`/api/projects/${id}`, { method: "PATCH", body: {} }).catch(() => {});
      void next;
    }, 800);
  }

  async function post() {
    if (!selected.length) return toast.push("Select at least one platform.", "error");
    const scheduledAt = schedule && when ? new Date(when).toISOString() : null;
    if (schedule && !scheduledAt) return toast.push("Pick a time to schedule.", "error");
    setBusy(true);
    try {
      const res = await api<{ publications: Publication[]; project: Project }>(`/api/projects/${id}/publish`, {
        method: "POST",
        body: { platforms: selected, caption, hashtags, title, scheduledAt },
      });
      setPublications(res.publications);
      setProject(res.project);
      const failed = res.publications.filter((p) => selected.includes(p.platform) && p.status === "failed");
      if (scheduledAt) toast.push(`Scheduled for ${new Date(scheduledAt).toLocaleString()}`, "success");
      else if (failed.length === 0) toast.push("Posted everywhere", "success");
      else toast.push(`${failed.length} platform(s) failed. See details below.`, "error");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function retry(platform: Platform) {
    setRetrying(platform);
    try {
      const res = await api<{ publications: Publication[]; project: Project }>(`/api/projects/${id}/publish/retry`, { method: "POST", body: { platform } });
      setPublications(res.publications);
      setProject(res.project);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRetrying(null);
    }
  }

  async function disconnect(platform: string) {
    if (!confirm(`Disconnect ${platform}?`)) return;
    await api(`/api/connections/${platform}`, { method: "DELETE" });
    await loadPublish();
    setSelected((s) => s.filter((p) => p !== platform));
  }

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!project) return <div className="flex justify-center p-12"><Spinner /></div>;

  const renderUrl = mediaUrl(project.edit.render?.file);
  const connected = platforms.filter((p) => p.connected);
  const anyConfigured = platforms.some((p) => p.configured);

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 md:px-4 md:py-6">
      <StageHeader stage="uploading" project={project} right={project.stage === "published" ? <Badge tone="success">Published</Badge> : undefined} />

      <Card className="mb-5 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Connected accounts</div>
            <div className="text-xs text-muted">
              {connected.length ? `${connected.length} of ${platforms.length} linked` : "Link the accounts you want to post to."}
              {!anyConfigured && platforms.length > 0 && " No platform credentials are configured on the server yet; see .env.example."}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => loadPublish()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <ConnectAccounts platforms={platforms} onDisconnect={disconnect} />
      </Card>

      {!renderUrl ? (
        <Card className="p-6 text-sm text-muted">
          {renderRunning ? (
            <span className="flex items-center gap-3"><Spinner /> Preparing your video…</span>
          ) : project.edit.render?.status === "failed" ? (
            <span className="text-danger">{project.edit.render.error}</span>
          ) : (
            "No rendered video yet. Go back to Editing and export first."
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
          <Card className="p-3">
            <video src={renderUrl} controls playsInline className="w-full rounded-xl bg-black" />
            <div className="mt-2 text-xs text-muted">
              {project.edit.render?.format} · {project.edit.render?.aspect} · {project.edit.render?.durationSec?.toFixed(1)}s
            </div>
          </Card>

          <div className="space-y-5">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Caption</div>
                <Button size="sm" variant="ghost" onClick={draftCaption} loading={drafting}>
                  <Sparkles className="h-3.5 w-3.5" /> Rewrite from script
                </Button>
              </div>
              <textarea
                value={caption}
                onChange={(e) => {
                  setCaption(e.target.value);
                  persistDraft({ caption: e.target.value });
                }}
                rows={4}
                className="mt-2 w-full resize-y rounded-xl border border-border bg-surface-2 p-3 text-sm outline-none focus:border-accent"
              />
              <label className="mt-3 block text-xs font-medium text-muted">Title (YouTube / TikTok / LinkedIn)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
              <div className="mt-3 text-xs font-medium text-muted">Hashtags</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {hashtags.map((h) => (
                  <span key={h} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                    #{h}
                    <button onClick={() => setHashtags((t) => t.filter((x) => x !== h))} aria-label={`Remove ${h}`}>
                      <X className="h-3 w-3 text-muted" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === "," || e.key === " ") && tagInput.trim()) {
                      e.preventDefault();
                      const t = tagInput.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "");
                      if (t && !hashtags.includes(t)) setHashtags((h) => [...h, t]);
                      setTagInput("");
                    }
                  }}
                  placeholder="add…"
                  className="min-w-[80px] flex-1 bg-transparent px-1 text-xs outline-none"
                />
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-medium">Post to</div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {platforms.map((p) => {
                  const pub = publications.find((x) => x.platform === p.platform);
                  return (
                    <label key={p.platform} className={cx("flex items-center gap-3 rounded-xl border p-3", p.connected ? "cursor-pointer border-border" : "border-border opacity-50")}>
                      <input
                        type="checkbox"
                        disabled={!p.connected}
                        checked={selected.includes(p.platform)}
                        onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.platform] : s.filter((x) => x !== p.platform)))}
                      />
                      <span className="w-6 text-center text-sm font-bold">{PLATFORM_ICON[p.platform]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">{p.label}</span>
                        <span className="block truncate text-xs text-muted">{p.connected ? p.accountName || "connected" : "not connected"}</span>
                      </span>
                      {pub && <StatusBadge status={pub.status} />}
                    </label>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} />
                  <CalendarClock className="h-4 w-4 text-muted" /> Schedule for later
                </label>
                {schedule && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} min={toLocalInput(new Date().toISOString())} className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent" />}
                <div className="flex-1" />
                <Button variant="primary" size="lg" onClick={post} loading={busy} disabled={!selected.length}>
                  <Send className="h-4 w-4" /> {schedule ? "Schedule everywhere" : "Post everywhere"}
                  {selected.length > 0 && ` (${selected.length})`}
                </Button>
              </div>
            </Card>

            {publications.length > 0 && (
              <Card className="p-4">
                <div className="mb-2 text-sm font-medium">Results</div>
                <div className="space-y-2">
                  {publications.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 text-sm">
                      <span className="w-6 text-center font-bold">{PLATFORM_ICON[p.platform]}</span>
                      <span className="w-24 capitalize">{p.platform}</span>
                      <StatusBadge status={p.status} />
                      <div className="min-w-0 flex-1 text-xs text-muted">
                        {p.status === "scheduled" && p.scheduledAt && `Scheduled for ${new Date(p.scheduledAt).toLocaleString()}`}
                        {p.status === "published" && p.publishedAt && `Posted ${new Date(p.publishedAt).toLocaleString()}`}
                        {p.status === "failed" && <span className="text-danger">{p.error}</span>}
                        {p.status === "publishing" && "Uploading…"}
                      </div>
                      {p.postUrl && (
                        <a href={p.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          Open post <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {(p.status === "failed" || p.status === "scheduled") && (
                        <Button size="sm" onClick={() => retry(p.platform)} loading={retrying === p.platform}>
                          <RefreshCw className="h-3.5 w-3.5" /> {p.status === "failed" ? "Retry" : "Post now"}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
      <button className="hidden" onClick={() => reload()} aria-hidden />
    </div>
  );
}

function StatusBadge({ status }: { status: Publication["status"] }) {
  const tone = status === "published" ? "success" : status === "failed" ? "danger" : status === "publishing" ? "warning" : "accent";
  return <Badge tone={tone}>{status}</Badge>;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
