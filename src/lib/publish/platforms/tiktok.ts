import fs from "node:fs";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import type { ConnectionRecord } from "@/lib/db/repo";
import { expiresAtFrom, fetchJson, postForm, sleep } from "../oauth";
import { PublishError, type PlatformAdapter, type PublishInput, type PublishOutput, type TokenSet } from "../types";

// TikTok Content Posting API (Direct Post, FILE_UPLOAD). Note: until the app
// passes TikTok's audit, posts are forced to SELF_ONLY privacy by TikTok.

const SCOPES = ["user.info.basic", "video.publish", "video.upload"];
const API = "https://open.tiktokapis.com/v2";

export const tiktok: PlatformAdapter = {
  platform: "tiktok",
  label: "TikTok",
  configured: () => !!(env.oauth.tiktok.id && env.oauth.tiktok.secret),
  usesPkce: true,
  authorizeUrl(state, redirect, verifier) {
    const p = new URLSearchParams({
      client_key: env.oauth.tiktok.id,
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirect,
      state,
    });
    if (verifier) {
      p.set("code_challenge", createHash("sha256").update(verifier).digest("hex"));
      p.set("code_challenge_method", "S256");
    }
    return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
  },
  async exchangeCode(code, redirect, verifier): Promise<TokenSet> {
    const t = await postForm(`${API}/oauth/token/`, {
      client_key: env.oauth.tiktok.id,
      client_secret: env.oauth.tiktok.secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
      ...(verifier ? { code_verifier: verifier } : {}),
    });
    if (!t.access_token) throw new Error(`TikTok token exchange failed: ${JSON.stringify(t).slice(0, 300)}`);
    const accessToken = String(t.access_token);
    let accountName: string | null = null;
    try {
      const u = await fetchJson<{ data?: { user?: { display_name?: string; username?: string } } }>(
        `${API}/user/info/?fields=open_id,display_name,username`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      accountName = u.data?.user?.username || u.data?.user?.display_name || null;
    } catch {
      /* optional */
    }
    return {
      accessToken,
      refreshToken: (t.refresh_token as string) || null,
      expiresAt: expiresAtFrom(t.expires_in as number),
      accountName,
      accountId: (t.open_id as string) || null,
    };
  },
  async refresh(conn): Promise<TokenSet> {
    const t = await postForm(`${API}/oauth/token/`, {
      client_key: env.oauth.tiktok.id,
      client_secret: env.oauth.tiktok.secret,
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken!,
    });
    return {
      accessToken: String(t.access_token),
      refreshToken: (t.refresh_token as string) || null,
      expiresAt: expiresAtFrom(t.expires_in as number),
    };
  },
  async publish(conn: ConnectionRecord, input: PublishInput): Promise<PublishOutput> {
    const auth = { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
    // Creator info tells us which privacy levels the account may post with.
    let privacy = "PUBLIC_TO_EVERYONE";
    try {
      const info = await fetchJson<{ data?: { privacy_level_options?: string[] } }>(`${API}/post/publish/creator_info/query/`, {
        method: "POST",
        headers: auth,
      });
      const options = info.data?.privacy_level_options || [];
      if (options.length && !options.includes(privacy)) privacy = options[0];
    } catch {
      /* fall through with the default */
    }
    const size = fs.statSync(input.filePath).size;
    const chunk = Math.min(size, 64 * 1024 * 1024);
    const init = await fetchJson<{ data?: { publish_id?: string; upload_url?: string }; error?: { code?: string; message?: string } }>(
      `${API}/post/publish/video/init/`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          post_info: {
            title: (input.title || input.caption).slice(0, 2200),
            privacy_level: privacy,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: Math.ceil(size / chunk) },
        }),
      },
    );
    if (init.error?.code && init.error.code !== "ok") throw new PublishError(`TikTok init failed: ${init.error.message || init.error.code}`, false);
    const publishId = init.data?.publish_id;
    const uploadUrl = init.data?.upload_url;
    if (!publishId || !uploadUrl) throw new PublishError("TikTok did not return an upload URL");

    const file = fs.readFileSync(input.filePath);
    for (let offset = 0; offset < size; offset += chunk) {
      const end = Math.min(size, offset + chunk);
      const part = file.subarray(offset, end);
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(part.length),
          "Content-Range": `bytes ${offset}-${end - 1}/${size}`,
        },
        body: part,
      });
      if (!res.ok && res.status !== 206) throw new PublishError(`TikTok upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }

    // Poll until TikTok finishes processing.
    let postId: string | null = null;
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const st = await fetchJson<{ data?: { status?: string; publicaly_available_post_id?: string[]; fail_reason?: string } }>(
        `${API}/post/publish/status/fetch/`,
        { method: "POST", headers: auth, body: JSON.stringify({ publish_id: publishId }) },
      );
      const status = st.data?.status;
      if (status === "PUBLISH_COMPLETE") {
        postId = st.data?.publicaly_available_post_id?.[0] || null;
        break;
      }
      if (status === "FAILED") throw new PublishError(`TikTok publish failed: ${st.data?.fail_reason || "unknown"}`, false);
    }
    const username = conn.accountName?.replace(/^@/, "");
    return {
      postId: postId || publishId,
      postUrl: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : username ? `https://www.tiktok.com/@${username}` : null,
    };
  },
};
