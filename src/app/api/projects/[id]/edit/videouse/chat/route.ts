import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, serverError } from "@/lib/http";
import { newId, nowIso } from "@/lib/ids";
import { readJson } from "@/lib/http";
import { edlFromCuts } from "@/lib/videouse";
import { planEdit } from "@/lib/videouse/planner";
import type { VideoUseMessage, VideoUseState } from "@/lib/types";

function ensureState(p: ReturnType<typeof getProject>): VideoUseState {
  const s = p!.edit.videouse || { messages: [], edl: null, grade: "auto", subtitleStyle: "bold-overlay" as const };
  p!.edit.videouse = s;
  return s;
}

// Conversation with the editor. Returns the assistant turn (with a proposed EDL when relevant).
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/videouse/chat">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  if (project.edit.analysis?.status !== "done") return badRequest("Run the cleanup pass first so the editor has a transcript to read.");
  const body = await readJson<{ message?: string }>(req);
  const message = (body.message || "").trim();
  if (!message) return badRequest("Say what you want changed.");
  const state = ensureState(project);
  if (!state.edl) state.edl = edlFromCuts(project);
  const userMsg: VideoUseMessage = { id: newId("m"), role: "user", content: message, createdAt: nowIso() };
  state.messages.push(userMsg);
  try {
    const plan = await planEdit(project, user, state.messages.slice(0, -1), message);
    const reply: VideoUseMessage = {
      id: newId("m"),
      role: "assistant",
      content: plan.reply,
      strategy: plan.strategy,
      edl: plan.edl,
      applied: false,
      createdAt: nowIso(),
    };
    // A tweak the creator did not need to confirm is applied straight away.
    if (plan.edl && !plan.needsConfirmation) {
      state.edl = plan.edl;
      state.grade = plan.edl.grade;
      state.subtitleStyle = plan.edl.subtitles;
      reply.applied = true;
    }
    state.messages.push(reply);
    state.messages = state.messages.slice(-40);
    saveProject(project);
    return json({ message: reply, videouse: state });
  } catch (err) {
    state.messages.pop();
    saveProject(project);
    return serverError(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/edit/videouse/chat">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const state = ensureState(project);
  state.messages = [];
  saveProject(project);
  return json({ videouse: state });
}
