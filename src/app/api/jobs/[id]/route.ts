import { getJob } from "@/lib/db/repo";
import { json, notFound } from "@/lib/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return notFound("Job not found");
  return json(job);
}
