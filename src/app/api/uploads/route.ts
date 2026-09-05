import { getCurrentUser } from "@/lib/auth";
import { badRequest, json, readJson } from "@/lib/http";
import { videoCapability } from "@/lib/media/capabilities";
import { initUpload } from "@/lib/uploads";

// Start a chunked upload. Returns the upload id and the chunk size clients should use.
const CHUNK_BYTES = 900 * 1024; // stays under the 1 MB body limit of most proxies

export async function POST(req: Request) {
  await getCurrentUser();
  const cap = videoCapability();
  if (!cap.ok) return badRequest(cap.reason || "Video processing is unavailable on this server", { videoUnavailable: true });
  const body = await readJson<{ name?: string; type?: string; size?: number }>(req);
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) return badRequest("Missing file size");
  if (size > 4 * 1024 * 1024 * 1024) return badRequest("File is larger than 4 GB");
  const meta = initUpload({ name: String(body.name || "video"), type: String(body.type || "video/mp4"), size });
  return json({ id: meta.id, chunkBytes: CHUNK_BYTES }, { status: 201 });
}
