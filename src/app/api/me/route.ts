import { getCurrentUser } from "@/lib/auth";
import { updateUser } from "@/lib/db/repo";
import { badRequest, json, readJson } from "@/lib/http";
import { NICHES } from "@/lib/types";
import { llmAvailable } from "@/lib/llm/client";
import { detectProvider } from "@/lib/editing/transcribe";
import { env } from "@/lib/env";

export async function GET() {
  const user = await getCurrentUser();
  return json({
    user,
    niches: NICHES,
    capabilities: {
      llm: llmAvailable() ? "deepseek" : "mock",
      transcription: detectProvider(),
      publishProvider: env.publish.provider,
    },
  });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  const body = await readJson<{ name?: string; handle?: string | null; niche?: string | null }>(req);
  const patch: { name?: string; handle?: string | null; niche?: string | null } = {};
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 80) || "Creator";
  if (body.handle !== undefined) patch.handle = body.handle ? String(body.handle).replace(/^@/, "").trim().slice(0, 40) : null;
  if (body.niche !== undefined) {
    const niche = body.niche ? String(body.niche).trim().toLowerCase().slice(0, 40) : null;
    if (niche !== null && niche.length === 0) return badRequest("Niche cannot be empty");
    patch.niche = niche;
  }
  const updated = updateUser(user.id, patch);
  return json({ user: updated });
}
