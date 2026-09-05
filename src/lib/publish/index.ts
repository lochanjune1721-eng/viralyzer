import { env } from "@/lib/env";
import {
  getConnection,
  getProject,
  listConnections,
  listPublications,
  updateProject,
  upsertPublication,
  type ConnectionRecord,
} from "@/lib/db/repo";
import { absPath, publicMediaUrl } from "@/lib/storage";
import type { Platform, Project, Publication, User } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { ayrshareConnected, ayrsharePost } from "./ayrshare";
import { ensureFreshToken } from "./oauth";
import { instagram } from "./platforms/instagram";
import { linkedin } from "./platforms/linkedin";
import { tiktok } from "./platforms/tiktok";
import { x } from "./platforms/x";
import { youtube } from "./platforms/youtube";
import { PublishError, type PlatformAdapter } from "./types";

export const ADAPTERS: Record<Platform, PlatformAdapter> = { tiktok, instagram, youtube, x, linkedin };

export function adapterFor(platform: string): PlatformAdapter | null {
  return (ADAPTERS as Record<string, PlatformAdapter>)[platform] || null;
}

export interface PlatformStatus {
  platform: Platform;
  label: string;
  configured: boolean; // OAuth app credentials present (or aggregator active)
  connected: boolean;
  accountName: string | null;
  via: "native" | "ayrshare";
}

export async function platformStatuses(userId: string): Promise<PlatformStatus[]> {
  if (env.publish.provider === "ayrshare" && env.publish.ayrshareKey) {
    let connected: Partial<Record<Platform, string>> = {};
    try {
      connected = await ayrshareConnected();
    } catch (err) {
      console.warn("ayrshare status failed", err);
    }
    return PLATFORMS.map((p) => ({
      platform: p,
      label: ADAPTERS[p].label,
      configured: true,
      connected: !!connected[p],
      accountName: connected[p] || null,
      via: "ayrshare",
    }));
  }
  const conns = new Map(listConnections(userId).map((c) => [c.platform, c]));
  return PLATFORMS.map((p) => ({
    platform: p,
    label: ADAPTERS[p].label,
    configured: ADAPTERS[p].configured(),
    connected: conns.has(p),
    accountName: conns.get(p)?.accountName || null,
    via: "native",
  }));
}

export interface PublishRequest {
  platforms: Platform[];
  caption: string;
  hashtags: string[];
  title: string;
  scheduledAt?: string | null;
}

function fullCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return [caption.trim(), tags].filter(Boolean).join("\n\n");
}

/** Create publication rows and either publish now or leave them scheduled. */
export async function publishProject(project: Project, user: User, req: PublishRequest): Promise<Publication[]> {
  if (!project.edit.render?.file) throw new Error("Render the video before publishing.");
  updateProject(project.id, (p) => {
    p.publish = { ...p.publish, caption: req.caption, hashtags: req.hashtags, title: req.title, selected: req.platforms, scheduledAt: req.scheduledAt || null };
  });
  const scheduled = req.scheduledAt && new Date(req.scheduledAt).getTime() > Date.now() + 30_000;
  for (const platform of req.platforms) {
    upsertPublication(project.id, platform, {
      status: "scheduled",
      scheduledAt: scheduled ? req.scheduledAt! : null,
      error: null,
      postUrl: null,
      postId: null,
    });
  }
  if (scheduled) return listPublications(project.id);
  return runPublications(project.id, req.platforms);
}

/** Publish (or retry) the given platforms for a project right now. */
export async function runPublications(projectId: string, platforms: Platform[]): Promise<Publication[]> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");
  const renderFile = project.edit.render?.file;
  if (!renderFile) throw new Error("No rendered video on this project");
  const caption = fullCaption(project.publish.caption || "", project.publish.hashtags || []);
  const title = project.publish.title || project.title;
  const filePath = absPath(renderFile);
  const publicUrl = publicMediaUrl(renderFile);

  for (const platform of platforms) upsertPublication(projectId, platform, { status: "publishing", error: null });

  if (env.publish.provider === "ayrshare" && env.publish.ayrshareKey) {
    try {
      const results = await ayrsharePost({ platforms, publicUrl, caption, title });
      for (const r of results) {
        upsertPublication(projectId, r.platform, {
          status: r.status === "success" ? "published" : "failed",
          postUrl: r.postUrl,
          postId: r.postId,
          error: r.error,
          publishedAt: r.status === "success" ? new Date().toISOString() : null,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const platform of platforms) upsertPublication(projectId, platform, { status: "failed", error: msg });
    }
  } else {
    await Promise.all(
      platforms.map(async (platform) => {
        try {
          const adapter = ADAPTERS[platform];
          let conn: ConnectionRecord | null = getConnection(project.userId, platform);
          if (!conn) throw new PublishError(`${adapter.label} is not connected`, false);
          conn = await ensureFreshToken(adapter, conn);
          const out = await adapter.publish(conn, { filePath, publicUrl, caption, title, hashtags: project.publish.hashtags || [], durationSec: project.edit.render?.durationSec });
          upsertPublication(projectId, platform, { status: "published", postUrl: out.postUrl, postId: out.postId, error: null, publishedAt: new Date().toISOString() });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[publish ${platform}]`, msg);
          upsertPublication(projectId, platform, { status: "failed", error: msg.slice(0, 1000) });
        }
      }),
    );
  }
  const pubs = listPublications(projectId);
  if (pubs.some((p) => p.status === "published")) {
    updateProject(projectId, (p) => {
      if (pubs.filter((x) => platforms.includes(x.platform)).every((x) => x.status === "published")) p.stage = "published";
    });
  }
  return pubs;
}
