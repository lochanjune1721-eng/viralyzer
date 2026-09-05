import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProject } from "@/lib/db/repo";
import { badRequest, json, notFound, serverError } from "@/lib/http";
import { timelineView } from "@/lib/videouse";

// Filmstrip + waveform PNG for a time range (?start=&end=&target=source|render).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/edit/videouse/timeline">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const start = Number(req.nextUrl.searchParams.get("start"));
  const end = Number(req.nextUrl.searchParams.get("end"));
  const target = req.nextUrl.searchParams.get("target") === "render" ? "render" : "source";
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return badRequest("Invalid range");
  try {
    const file = await timelineView(project, Math.max(0, start), end, target);
    return json({ file });
  } catch (err) {
    return serverError(err);
  }
}
