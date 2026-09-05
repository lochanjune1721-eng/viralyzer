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
