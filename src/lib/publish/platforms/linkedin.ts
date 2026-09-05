import fs from "node:fs";
import { env } from "@/lib/env";
import type { ConnectionRecord } from "@/lib/db/repo";
import { expiresAtFrom, fetchJson, postForm, sleep } from "../oauth";
import { PublishError, type PlatformAdapter, type PublishInput, type PublishOutput, type TokenSet } from "../types";

// LinkedIn member video posts via the Videos API + Posts API.

const SCOPES = ["openid", "profile", "w_member_social"];
const VERSION = "202409";
const REST = "https://api.linkedin.com/rest";

export const linkedin: PlatformAdapter = {
  platform: "linkedin",
  label: "LinkedIn",
  configured: () => !!(env.oauth.linkedin.id && env.oauth.linkedin.secret),
  authorizeUrl(state, redirect) {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: env.oauth.linkedin.id,
      redirect_uri: redirect,
      state,
      scope: SCOPES.join(" "),
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
  },
  async exchangeCode(code, redirect): Promise<TokenSet> {
    const t = await postForm("https://www.linkedin.com/oauth/v2/accessToken", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: env.oauth.linkedin.id,
      client_secret: env.oauth.linkedin.secret,
    });
    const accessToken = String(t.access_token);
    const me = await fetchJson<{ sub?: string; name?: string }>("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    return {
      accessToken,
      refreshToken: (t.refresh_token as string) || null,
      expiresAt: expiresAtFrom(t.expires_in as number),
      accountName: me.name || null,
      accountId: me.sub ? `urn:li:person:${me.sub}` : null,
    };
  },
  async refresh(conn): Promise<TokenSet> {
    const t = await postForm("https://www.linkedin.com/oauth/v2/accessToken", {
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken!,
      client_id: env.oauth.linkedin.id,
      client_secret: env.oauth.linkedin.secret,
    });
    return { accessToken: String(t.access_token), refreshToken: (t.refresh_token as string) || null, expiresAt: expiresAtFrom(t.expires_in as number) };
  },
  async publish(conn: ConnectionRecord, input: PublishInput): Promise<PublishOutput> {
    const owner = conn.accountId;
    if (!owner) throw new PublishError("LinkedIn member URN missing; reconnect the account.", false);
    const headers = {
      Authorization: `Bearer ${conn.accessToken}`,
      "LinkedIn-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    };
    const size = fs.statSync(input.filePath).size;
    const init = await fetchJson<{
      value?: { uploadInstructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>; video?: string; uploadToken?: string };
    }>(`${REST}/videos?action=initializeUpload`, {
      method: "POST",
      headers,
      body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } }),
    });
    const instructions = init.value?.uploadInstructions || [];
    const videoUrn = init.value?.video;
    if (!videoUrn || !instructions.length) throw new PublishError("LinkedIn did not return upload instructions");
    const file = fs.readFileSync(input.filePath);
    const etags: string[] = [];
    for (const ins of instructions) {
      const part = file.subarray(ins.firstByte, ins.lastByte + 1);
      const res = await fetch(ins.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: part });
      if (!res.ok) throw new PublishError(`LinkedIn chunk upload failed (${res.status})`);
      etags.push(res.headers.get("etag") || "");
    }
    const fin = await fetch(`${REST}/videos?action=finalizeUpload`, {
      method: "POST",
      headers,
      body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken: init.value?.uploadToken || "", uploadedPartIds: etags } }),
    });
    if (!fin.ok) throw new PublishError(`LinkedIn finalize failed (${fin.status}): ${(await fin.text()).slice(0, 300)}`);
    // wait until the asset is AVAILABLE
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const st = await fetchJson<{ status?: string }>(`${REST}/videos/${encodeURIComponent(videoUrn)}`, { headers });
      if (st.status === "AVAILABLE") break;
      if (st.status === "PROCESSING_FAILED") throw new PublishError("LinkedIn could not process the video", false);
    }
    const post = await fetch(`${REST}/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        author: owner,
        commentary: input.caption.slice(0, 3000),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { title: (input.title || "Video").slice(0, 200), id: videoUrn } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!post.ok) throw new PublishError(`LinkedIn post failed (${post.status}): ${(await post.text()).slice(0, 300)}`);
    const urn = post.headers.get("x-restli-id") || post.headers.get("x-linkedin-id") || null;
    return { postId: urn, postUrl: urn ? `https://www.linkedin.com/feed/update/${urn}` : null };
  },
};
