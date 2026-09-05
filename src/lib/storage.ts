import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

// Media files live on local disk under STORAGE_DIR. Paths stored on projects
// are relative to that root so the backing store can be swapped for S3 later.

export function storageRoot(): string {
  fs.mkdirSync(env.storageDir, { recursive: true });
  return env.storageDir;
}

export function absPath(relative: string): string {
  const root = storageRoot();
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error("Invalid storage path");
  }
  return resolved;
}

export function ensureDir(relativeDir: string): string {
  const dir = absPath(relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectDir(projectId: string, sub?: string): string {
  return ensureDir(sub ? path.join("projects", projectId, sub) : path.join("projects", projectId));
}

export function relPath(absolute: string): string {
  return path.relative(storageRoot(), absolute).split(path.sep).join("/");
}

export function mediaUrl(relative: string | null | undefined): string | null {
  if (!relative) return null;
  return "/api/media/" + relative.split("/").map(encodeURIComponent).join("/");
}

export function publicMediaUrl(relative: string): string {
  return env.publicBaseUrl + mediaUrl(relative);
}

export function removeIfExists(relative: string | null | undefined): void {
  if (!relative) return;
  try {
    fs.rmSync(absPath(relative), { force: true });
  } catch {
    /* ignore */
  }
}

export function fileSize(relative: string): number {
  return fs.statSync(absPath(relative)).size;
}
