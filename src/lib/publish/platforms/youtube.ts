import fs from "node:fs";
import { env } from "@/lib/env";
import type { ConnectionRecord } from "@/lib/db/repo";
import { expiresAtFrom, fetchJson, postForm } from "../oauth";
import { PublishError, type PlatformAdapter, type PublishInput, type PublishOutput, type TokenSet } from "../types";

// YouTube Shorts via the YouTube Data API v3. A vertical video under 3 minutes
// is automatically surfaced as a Short; "#Shorts" in the title/description helps.

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

export const youtube: PlatformAdapter = {
  platform: "youtube",
  label: "YouTube Shorts",
  configured: () => !!(env.oauth.google.id && env.oauth.google.secret),
  authorizeUrl(state, redirect) {
    const p = new URLSearchParams({
      client_id: env.oauth.google.id,
      redirect_uri: redirect,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },
  async exchangeCode(code, redirect): Promise<TokenSet> {
    const t = await postForm("https://oauth2.googleapis.com/token", {
      code,
      client_id: env.oauth.google.id,
      client_secret: env.oauth.google.secret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    });
    const accessToken = String(t.access_token);
    const ch = await fetchJson<{ items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const channel = ch.items?.[0];
    return {
      accessToken,
      refreshToken: (t.refresh_token as string) || null,
      expiresAt: expiresAtFrom(t.expires_in as number),
      accountName: channel?.snippet?.title || channel?.snippet?.customUrl || null,
      accountId: channel?.id || null,
    };
  },
  async refresh(conn): Promise<TokenSet> {
    const t = await postForm("https://oauth2.googleapis.com/token", {
      client_id: env.oauth.google.id,
      client_secret: env.oauth.google.secret,
      refresh_token: conn.refreshToken!,
      grant_type: "refresh_token",
    });
    return { accessToken: String(t.access_token), expiresAt: expiresAtFrom(t.expires_in as number) };
  },
  async publish(conn: ConnectionRecord, input: PublishInput): Promise<PublishOutput> {
    const meta = {
      snippet: {
        title: (input.title || input.caption.split("\n")[0] || "New Short").slice(0, 95) + (/#shorts/i.test(input.title) ? "" : " #Shorts"),
        description: input.caption.slice(0, 4900),
        tags: input.hashtags.slice(0, 20),
        categoryId: "22",
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    };
    const boundary = "vz-" + Date.now().toString(36);
    const video = fs.readFileSync(input.filePath);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--`);
    const body = Buffer.concat([head, video, tail]);
    const res = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new PublishError(`YouTube upload failed (${res.status}): ${text.slice(0, 400)}`, res.status >= 500 || res.status === 429);
    const data = JSON.parse(text) as { id?: string };
    if (!data.id) throw new PublishError("YouTube did not return a video id");
    return { postId: data.id, postUrl: `https://www.youtube.com/shorts/${data.id}` };
  },
};
