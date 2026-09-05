import fs from "node:fs";
import path from "node:path";
import { newId } from "@/lib/ids";
import { ensureDir, absPath } from "@/lib/storage";

// Chunked uploads: browsers send a video in small pieces (under 1 MB each) so
// reverse proxies with tiny body limits (Codespaces, nginx defaults, tunnels)
// never reject them. Pieces are appended in order to a .part file and the
// finished file is handed to the take / import handlers.

export interface UploadMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  received: number;
  createdAt: number;
}

const DIR = "uploads";

function metaPath(id: string): string {
  return absPath(path.join(DIR, `${id}.json`));
}
function partPath(id: string): string {
  return absPath(path.join(DIR, `${id}.part`));
}

export function initUpload(input: { name: string; type: string; size: number }): UploadMeta {
  ensureDir(DIR);
  pruneOldUploads();
  const meta: UploadMeta = { id: newId("up"), name: input.name, type: input.type, size: input.size, received: 0, createdAt: Date.now() };
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta));
  fs.writeFileSync(partPath(meta.id), "");
  return meta;
}

export function readUpload(id: string): UploadMeta | null {
  if (!/^up_[a-z0-9]+$/.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8")) as UploadMeta;
  } catch {
    return null;
  }
}

/** Append a chunk. `offset` must equal bytes received so far (sequential, resumable). */
export function appendChunk(id: string, offset: number, chunk: Buffer): UploadMeta {
  const meta = readUpload(id);
  if (!meta) throw new Error("Unknown upload");
  if (offset !== meta.received) throw new Error(`Chunk out of order: expected offset ${meta.received}, got ${offset}`);
  if (meta.received + chunk.length > meta.size) throw new Error("Upload exceeds declared size");
  fs.appendFileSync(partPath(id), chunk);
  meta.received += chunk.length;
  fs.writeFileSync(metaPath(id), JSON.stringify(meta));
  return meta;
}

/** Claim the finished file: returns its absolute path and the original name/type. Caller moves or deletes it. */
export function takeCompletedUpload(id: string): { path: string; name: string; type: string; size: number } {
  const meta = readUpload(id);
  if (!meta) throw new Error("Unknown upload");
  if (meta.received !== meta.size) throw new Error(`Upload incomplete (${meta.received} of ${meta.size} bytes)`);
  fs.rmSync(metaPath(id), { force: true });
  return { path: partPath(id), name: meta.name, type: meta.type, size: meta.size };
}

function pruneOldUploads(): void {
  try {
    const dir = absPath(DIR);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch {
    /* ignore */
  }
}
