"use client";

// Tiny fetch wrapper used by all client components.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  url: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let body = init.body as BodyInit | undefined;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(url, { ...init, headers, body, cache: "no-store" });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

/**
 * Upload a video in small chunks (each under 1 MB) so proxies with tiny body
 * limits never reject it. Resolves with an uploadId to pass instead of a file.
 */
export async function uploadVideoChunked(
  file: Blob,
  name: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const init = await api<{ id: string; chunkBytes: number }>("/api/uploads", {
    method: "POST",
    body: { name, type: file.type || "video/mp4", size: file.size },
  });
  let chunkBytes = init.chunkBytes || 512 * 1024;
  const MIN_CHUNK = 32 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(file.size, offset + chunkBytes);
    const part = file.slice(offset, end);
    let attempt = 0;
    let sent = false;
    for (;;) {
      try {
        await api(`/api/uploads/${init.id}?offset=${offset}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: part,
        });
        sent = true;
        break;
      } catch (err) {
        // A proxy in front of the app rejected the body size: shrink and resend this piece.
        if (err instanceof ApiError && err.status === 413 && chunkBytes > MIN_CHUNK) {
          chunkBytes = Math.max(MIN_CHUNK, Math.floor(chunkBytes / 2));
          break;
        }
        if (++attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    if (!sent) continue; // retry the same offset with the smaller size
    offset = end;
    onProgress?.(offset / file.size);
  }
  return init.id;
}

export function mediaUrl(relative: string | null | undefined): string | null {
  if (!relative) return null;
  return "/api/media/" + relative.split("/").map(encodeURIComponent).join("/");
}

export async function pollJob(
  jobId: string,
  onProgress?: (job: { progress: number; message: string | null; status: string }) => void,
  intervalMs = 1200,
  timeoutMs = 45 * 60 * 1000,
): Promise<{ status: string; result: unknown; error: string | null }> {
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > timeoutMs) return { status: "failed", result: null, error: "The job did not finish in time. If this server cannot process video, see the banner at the top of the page." };
    const job = await api<{ status: string; progress: number; message: string | null; result: unknown; error: string | null }>(
      `/api/jobs/${jobId}`,
    );
    onProgress?.(job);
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
