import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveOauthState } from "@/lib/db/repo";
import { badRequest } from "@/lib/http";
import { adapterFor } from "@/lib/publish";
import { pkcePair, randomState, redirectUri } from "@/lib/publish/oauth";

// Starts the OAuth dance for a platform and redirects the browser to it.
export async function GET(_req: Request, ctx: RouteContext<"/api/connections/[platform]/authorize">) {
  const user = await getCurrentUser();
  const { platform } = await ctx.params;
  const adapter = adapterFor(platform);
  if (!adapter) return badRequest("Unknown platform");
  if (!adapter.configured()) return badRequest(`${adapter.label} is not configured. Add its client id/secret to the server environment.`);
  const state = randomState();
  const pkce = adapter.usesPkce ? pkcePair() : null;
  saveOauthState(state, user.id, adapter.platform, pkce?.verifier);
  return NextResponse.redirect(adapter.authorizeUrl(state, redirectUri(adapter.platform), pkce?.verifier));
}
