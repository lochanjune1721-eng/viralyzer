import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { absPath } from "@/lib/storage";

// Serves stored media with HTTP Range support so <video> can seek. Files are
// addressed by their storage-relative path; traversal is rejected by absPath.

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".ass": "text/plain; charset=utf-8",
};

export async function GET(req: Request, ctx: RouteContext<"/api/media/[...path]">) {
  const { path: parts } = await ctx.params;
  let file: string;
  try {
    file = absPath(parts.map(decodeURIComponent).join("/"));
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : size - 1;
    if (Number.isNaN(start) || start >= size) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Content-Length"] = String(end - start + 1);
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  const stream = fs.createReadStream(file);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}
