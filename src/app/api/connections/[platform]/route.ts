import { getCurrentUser } from "@/lib/auth";
import { deleteConnection } from "@/lib/db/repo";
import { badRequest, json } from "@/lib/http";
import { PLATFORMS, type Platform } from "@/lib/types";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/connections/[platform]">) {
  const user = await getCurrentUser();
  const { platform } = await ctx.params;
  if (!PLATFORMS.includes(platform as Platform)) return badRequest("Unknown platform");
  deleteConnection(user.id, platform as Platform);
  return json({ ok: true });
}
