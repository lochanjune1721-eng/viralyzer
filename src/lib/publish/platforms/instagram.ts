import { env } from "@/lib/env";
import type { ConnectionRecord } from "@/lib/db/repo";
import { expiresAtFrom, fetchJson, postForm, sleep } from "../oauth";
import { PublishError, type PlatformAdapter, type PublishInput, type PublishOutput, type TokenSet } from "../types";

// Instagram Reels through the "Instagram API with Instagram Login". Instagram
// fetches the video from a public URL, so PUBLIC_BASE_URL must be reachable.

const GRAPH = "https://graph.instagram.com/v21.0";
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export const instagram: PlatformAdapter = {
  platform: "instagram",
  label: "Instagram Reels",
  configured: () => !!(env.oauth.instagram.id && env.oauth.instagram.secret),
  authorizeUrl(state, redirect) {
    const p = new URLSearchParams({
      client_id: env.oauth.instagram.id,
      redirect_uri: redirect,
      scope: SCOPES.join(","),
      response_type: "code",
      state,
      enable_fb_login: "0",
      force_authentication: "1",
    });
    return `https://www.instagram.com/oauth/authorize?${p}`;
  },
  async exchangeCode(code, redirect): Promise<TokenSet> {
    const short = await postForm("https://api.instagram.com/oauth/access_token", {
      client_id: env.oauth.instagram.id,
      client_secret: env.oauth.instagram.secret,
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code,
    });
    if (!short.access_token) throw new Error(`Instagram token exchange failed: ${JSON.stringify(short).slice(0, 300)}`);
    // exchange for a 60-day token
    const long = await fetchJson<{ access_token?: string; expires_in?: number }>(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${env.oauth.instagram.secret}&access_token=${short.access_token}`,
    );
    const accessToken = long.access_token || String(short.access_token);
    const me = await fetchJson<{ user_id?: string; id?: string; username?: string }>(`${GRAPH}/me?fields=user_id,username&access_token=${accessToken}`);
    return {
      accessToken,
      refreshToken: accessToken,
      expiresAt: expiresAtFrom(long.expires_in || 60 * 24 * 3600),
      accountName: me.username || null,
      accountId: me.user_id || me.id || String(short.user_id || ""),
    };
  },
  async refresh(conn): Promise<TokenSet> {
    const r = await fetchJson<{ access_token?: string; expires_in?: number }>(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${conn.accessToken}`,
    );
    return { accessToken: r.access_token || conn.accessToken, refreshToken: r.access_token, expiresAt: expiresAtFrom(r.expires_in) };
  },
  async publish(conn: ConnectionRecord, input: PublishInput): Promise<PublishOutput> {
    if (!/^https:\/\//.test(input.publicUrl) || /localhost|127\.0\.0\.1/.test(input.publicUrl)) {
      throw new PublishError("Instagram needs a public HTTPS URL for the video. Set PUBLIC_BASE_URL to your deployed domain.", false);
    }
    const igUser = conn.accountId;
    if (!igUser) throw new PublishError("Instagram account id missing; reconnect the account.", false);
    const container = await fetchJson<{ id?: string; error?: { message?: string } }>(`${GRAPH}/${igUser}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "REELS",
        video_url: input.publicUrl,
        caption: input.caption.slice(0, 2200),
        share_to_feed: "true",
        access_token: conn.accessToken,
      }).toString(),
    });
    if (!container.id) throw new PublishError(`Instagram container failed: ${container.error?.message || "unknown"}`);
    for (let i = 0; i < 60; i++) {
      await sleep(4000);
      const st = await fetchJson<{ status_code?: string; status?: string }>(`${GRAPH}/${container.id}?fields=status_code,status&access_token=${conn.accessToken}`);
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new PublishError(`Instagram processing failed: ${st.status || st.status_code}`);
    }
    const pub = await fetchJson<{ id?: string; error?: { message?: string } }>(`${GRAPH}/${igUser}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: container.id, access_token: conn.accessToken }).toString(),
    });
    if (!pub.id) throw new PublishError(`Instagram publish failed: ${pub.error?.message || "unknown"}`);
    let permalink: string | null = null;
    try {
      const m = await fetchJson<{ permalink?: string }>(`${GRAPH}/${pub.id}?fields=permalink&access_token=${conn.accessToken}`);
      permalink = m.permalink || null;
    } catch {
      /* optional */
    }
    return { postId: pub.id, postUrl: permalink || (conn.accountName ? `https://www.instagram.com/${conn.accountName}/reels/` : null) };
  },
};
