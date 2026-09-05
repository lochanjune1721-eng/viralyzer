import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { badRequest, json, notFound } from "@/lib/http";
import { appendChunk, readUpload } from "@/lib/uploads";

// PUT /api/uploads/:id?offset=N with the raw chunk as the body.
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  await getCurrentUser();
  const { id } = await ctx.params;
  if (!readUpload(id)) return notFound("Upload not found or expired");
  const offset = Number(req.nextUrl.searchParams.get("offset"));
  if (!Number.isFinite(offset) || offset < 0) return badRequest("Missing offset");
  const chunk = Buffer.from(await req.arrayBuffer());
  if (!chunk.length) return badRequest("Empty chunk");
  try {
    const meta = appendChunk(id, offset, chunk);
    return json({ received: meta.received, size: meta.size, done: meta.received === meta.size });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err));
  }
}

export async function GET(_req: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  await getCurrentUser();
  const { id } = await ctx.params;
  const meta = readUpload(id);
  if (!meta) return notFound("Upload not found or expired");
  return json({ received: meta.received, size: meta.size, done: meta.received === meta.size });
}
