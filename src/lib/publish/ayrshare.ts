import { env } from "@/lib/env";
import type { Platform } from "@/lib/types";
import { PublishError } from "./types";

// Optional aggregator path: one API key posts to every platform linked in the
// user's Ayrshare dashboard. Used when AYRSHARE_API_KEY is set.

const MAP: Record<Platform, string> = {
  tiktok: "tiktok",
  instagram: "instagram",
  youtube: "youtube",
  x: "twitter",
  linkedin: "linkedin",
};

export interface AyrshareResult {
  platform: Platform;
  status: "success" | "error";
  postUrl: string | null;
  postId: string | null;
  error: string | null;
}

export async function ayrshareConnected(): Promise<Partial<Record<Platform, string>>> {
  const res = await fetch("https://api.ayrshare.com/api/user", { headers: { Authorization: `Bearer ${env.publish.ayrshareKey}` } });
  if (!res.ok) throw new Error(`Ayrshare user lookup failed (${res.status})`);
  const data = (await res.json()) as { activeSocialAccounts?: string[]; displayNames?: Array<{ platform: string; displayName?: string; username?: string }> };
  const out: Partial<Record<Platform, string>> = {};
  for (const [platform, ayr] of Object.entries(MAP) as Array<[Platform, string]>) {
    if (data.activeSocialAccounts?.includes(ayr)) {
      const dn = data.displayNames?.find((d) => d.platform === ayr);
      out[platform] = dn?.username || dn?.displayName || "connected";
    }
  }
  return out;
}

export async function ayrsharePost(input: {
  platforms: Platform[];
  publicUrl: string;
  caption: string;
  title: string;
  scheduledAt?: string | null;
}): Promise<AyrshareResult[]> {
  if (!/^https:\/\//.test(input.publicUrl) || /localhost|127\.0\.0\.1/.test(input.publicUrl)) {
    throw new PublishError("Ayrshare needs a public HTTPS URL for the video. Set PUBLIC_BASE_URL to your deployed domain.", false);
  }
  const body: Record<string, unknown> = {
    post: input.caption,
    platforms: input.platforms.map((p) => MAP[p]),
    mediaUrls: [input.publicUrl],
    isVideo: true,
    youTubeOptions: { title: input.title || input.caption.slice(0, 90), visibility: "public", shorts: true },
    instagramOptions: { reels: true, shareReelsFeed: true },
    tikTokOptions: { title: input.title || undefined },
  };
  if (input.scheduledAt) body.scheduleDate = input.scheduledAt;
  const res = await fetch("https://api.ayrshare.com/api/post", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.publish.ayrshareKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    errors?: Array<{ platform?: string; message?: string }>;
    postIds?: Array<{ platform: string; status?: string; postUrl?: string; id?: string; message?: string }>;
    message?: string;
  };
  if (!res.ok && !data.postIds?.length) throw new PublishError(`Ayrshare failed (${res.status}): ${data.message || JSON.stringify(data.errors || data).slice(0, 300)}`);
  const reverse = Object.fromEntries(Object.entries(MAP).map(([k, v]) => [v, k])) as Record<string, Platform>;
  const results: AyrshareResult[] = [];
  for (const p of input.platforms) {
    const ayr = MAP[p];
    const hit = data.postIds?.find((r) => r.platform === ayr);
    const err = data.errors?.find((e) => e.platform === ayr);
    if (hit && (hit.status === "success" || hit.postUrl || hit.id)) {
      results.push({ platform: reverse[hit.platform] || p, status: "success", postUrl: hit.postUrl || null, postId: hit.id || null, error: null });
    } else {
      results.push({ platform: p, status: "error", postUrl: null, postId: null, error: err?.message || hit?.message || data.message || "Ayrshare did not return a result" });
    }
  }
  return results;
}
