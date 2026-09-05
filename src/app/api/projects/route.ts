import { getCurrentUser } from "@/lib/auth";
import { createProject, listProjects } from "@/lib/db/repo";
import { badRequest, json, readJson } from "@/lib/http";

export async function GET() {
  const user = await getCurrentUser();
  return json({ projects: listProjects(user.id) });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await readJson<{ idea?: string; reference?: string }>(req);
  const idea = (body.idea || "").trim();
  const reference = (body.reference || "").trim();
  if (!idea && !reference) return badRequest("Type an idea or paste a reference.");
  const project = createProject(user.id, { idea: idea || reference, reference: reference || null });
  return json({ project }, { status: 201 });
}
