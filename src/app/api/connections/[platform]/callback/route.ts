import { NextRequest, NextResponse } from "next/server";
import { consumeOauthState, upsertConnection } from "@/lib/db/repo";
import { env } from "@/lib/env";
import { adapterFor } from "@/lib/publish";
import { redirectUri } from "@/lib/publish/oauth";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/connections/[platform]/callback">) {
  const { platform } = await ctx.params;
  const adapter = adapterFor(platform);
  const back = (msg: string, ok: boolean) =>
    NextResponse.redirect(`${env.publicBaseUrl}/uploading?connect=${platform}&${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`);
  if (!adapter) return back("Unknown platform", false);
  const params = req.nextUrl.searchParams;
  const error = params.get("error_description") || params.get("error");
  if (error) return back(error, false);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back("Missing code or state", false);
  const saved = consumeOauthState(state);
  if (!saved || saved.platform !== adapter.platform) return back("Invalid or expired state. Try connecting again.", false);
  try {
    const tokens = await adapter.exchangeCode(code, redirectUri(adapter.platform), saved.verifier || undefined);
    upsertConnection({
      userId: saved.userId,
      platform: adapter.platform,
      accountName: tokens.accountName ?? null,
      accountId: tokens.accountId ?? null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      expiresAt: tokens.expiresAt ?? null,
      meta: tokens.meta,
    });
    return back(tokens.accountName || "connected", true);
  } catch (err) {
    return back(err instanceof Error ? err.message : String(err), false);
  }
}
