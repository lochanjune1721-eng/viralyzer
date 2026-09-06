import { getCurrentUser } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/db/repo";
import { badRequest, json, notFound, readJson } from "@/lib/http";
import type { AspectId, CaptionStyleId, CaptionWord, FormatId } from "@/lib/types";

const FORMATS: FormatId[] = ["split", "overlay", "captions", "motion"];
const ASPECTS: AspectId[] = ["9:16", "1:1", "16:9"];
const STYLES: CaptionStyleId[] = ["bold", "boxed", "minimal", "neon"];

// Format / aspect / caption style / caption text edits / key phrases.
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/edit/settings">) {
  const user = await getCurrentUser();
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return notFound("Project not found");
  const body = await readJson<{ format?: FormatId; aspect?: AspectId; captionStyle?: CaptionStyleId; captions?: CaptionWord[]; keyPhrases?: string[]; facePosition?: "top" | "bottom" }>(req);
  if (body.facePosition === "top" || body.facePosition === "bottom") project.edit.facePosition = body.facePosition;
  if (body.format) {
    if (!FORMATS.includes(body.format)) return badRequest("Unknown format");
    project.edit.format = body.format;
  }
  if (body.aspect) {
    if (!ASPECTS.includes(body.aspect)) return badRequest("Unknown aspect");
    project.edit.aspect = body.aspect;
  }
  if (body.captionStyle) {
    if (!STYLES.includes(body.captionStyle)) return badRequest("Unknown caption style");
    project.edit.captionStyle = body.captionStyle;
  }
  if (Array.isArray(body.captions)) {
    const cur = project.edit.captions || [];
    if (body.captions.length !== cur.length) return badRequest("Caption word count mismatch");
    project.edit.captions = cur.map((w, i) => ({ ...w, text: String(body.captions![i].text ?? w.text).slice(0, 40) }));
  }
  if (Array.isArray(body.keyPhrases)) project.edit.keyPhrases = body.keyPhrases.map((p) => String(p).trim()).filter(Boolean).slice(0, 12);
  project.edit.render = { status: "idle" };
  saveProject(project);
  return json({ project });
}
