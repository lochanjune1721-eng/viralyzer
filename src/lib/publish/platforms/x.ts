import fs from "node:fs";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import type { ConnectionRecord } from "@/lib/db/repo";
import { basicAuth, expiresAtFrom, fetchJson, postForm, sleep } from "../oauth";
import { PublishError, type PlatformAdapter, type PublishInput, type PublishOutput, type TokenSet } from "../types";

// X (Twitter) via OAuth 2.0 PKCE + v2 chunked media upload + POST /2/tweets.

const SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const API = "https://api.x.com/2";

export const x: PlatformAdapter = {
  platform: "x",
  label: "X",
  configured: () => !!env.oauth.x.id,
  usesPkce: true,
  authorizeUrl(state, redirect, verifier) {
    const challenge = createHash("sha256").update(verifier || "").digest("base64url");
    const p = new URLSearchParams({
      response_type: "code",
      client_id: env.oauth.x.id,
      redirect_uri: redirect,
      scope: SCOPES.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${p}`;
  },
  async exchangeCode(code, redirect, verifier): Promise<TokenSet> {
    const headers: Record<string, string> = env.oauth.x.secret ? { Authorization: basicAuth(env.oauth.x.id, env.oauth.x.secret) } : {};
    const t = await postForm(
      `${API}/oauth2/token`,
      { code, grant_type: "authorization_code", client_id: env.oauth.x.id, redirect_uri: redirect, code_verifier: verifier || "" },
      headers,
    );
    const accessToken = String(t.access_token);
    const me = await fetchJson<{ data?: { id?: string; username?: string } }>(`${API}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return {
      accessToken,
      refreshToken: (t.refresh_token as string) || null,
      expiresAt: expiresAtFrom(t.expires_in as number),
      accountName: me.data?.username || null,
      accountId: me.data?.id || null,
    };
  },
  async refresh(conn): Promise<TokenSet> {
    const headers: Record<string, string> = env.oauth.x.secret ? { Authorization: basicAuth(env.oauth.x.id, env.oauth.x.secret) } : {};
    const t = await postForm(`${API}/oauth2/token`, { grant_type: "refresh_token", refresh_token: conn.refreshToken!, client_id: env.oauth.x.id }, headers);
    return { accessToken: String(t.access_token), refreshToken: (t.refresh_token as string) || null, expiresAt: expiresAtFrom(t.expires_in as number) };
  },
  async publish(conn: ConnectionRecord, input: PublishInput): Promise<PublishOutput> {
    const auth = { Authorization: `Bearer ${conn.accessToken}` };
    const size = fs.statSync(input.filePath).size;
    const initForm = new FormData();
    initForm.append("command", "INIT");
    initForm.append("media_type", "video/mp4");
    initForm.append("total_bytes", String(size));
    initForm.append("media_category", "tweet_video");
    const init = await fetchJson<{ data?: { id?: string; media_key?: string }; media_id_string?: string }>(`${API}/media/upload`, {
      method: "POST",
      headers: auth,
      body: initForm,
    });
    const mediaId = init.data?.id || init.media_id_string;
    if (!mediaId) throw new PublishError("X media INIT did not return an id");

    const file = fs.readFileSync(input.filePath);
    const chunk = 4 * 1024 * 1024;
    let seg = 0;
    for (let offset = 0; offset < size; offset += chunk, seg++) {
      const part = file.subarray(offset, Math.min(size, offset + chunk));
      const form = new FormData();
      form.append("command", "APPEND");
      form.append("media_id", mediaId);
      form.append("segment_index", String(seg));
      form.append("media", new Blob([part], { type: "application/octet-stream" }), "chunk.bin");
      const res = await fetch(`${API}/media/upload`, { method: "POST", headers: auth, body: form });
      if (!res.ok && res.status !== 204) throw new PublishError(`X media APPEND failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const finForm = new FormData();
    finForm.append("command", "FINALIZE");
    finForm.append("media_id", mediaId);
    const fin = await fetchJson<{ data?: { processing_info?: { state?: string; check_after_secs?: number } }; processing_info?: { state?: string; check_after_secs?: number } }>(
      `${API}/media/upload`,
      { method: "POST", headers: auth, body: finForm },
    );
    let info = fin.data?.processing_info || fin.processing_info;
    for (let i = 0; i < 40 && info && info.state !== "succeeded"; i++) {
      if (info.state === "failed") throw new PublishError("X rejected the video during processing", false);
      await sleep((info.check_after_secs || 3) * 1000);
      const st = await fetchJson<{ data?: { processing_info?: { state?: string; check_after_secs?: number } }; processing_info?: { state?: string; check_after_secs?: number } }>(
        `${API}/media/upload?command=STATUS&media_id=${mediaId}`,
        { headers: auth },
      );
      info = st.data?.processing_info || st.processing_info;
    }
    const tweet = await fetchJson<{ data?: { id?: string } }>(`${API}/tweets`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.caption.slice(0, 280), media: { media_ids: [mediaId] } }),
    });
    const id = tweet.data?.id;
    if (!id) throw new PublishError("X did not return a post id");
    return { postId: id, postUrl: conn.accountName ? `https://x.com/${conn.accountName}/status/${id}` : `https://x.com/i/status/${id}` };
  },
};
