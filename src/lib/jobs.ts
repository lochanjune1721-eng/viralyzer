import { createJob, getJob, updateJob } from "@/lib/db/repo";
import type { Job } from "@/lib/types";

// Minimal in-process background job runner backed by the jobs table. Work runs
// in the Node server process (FFmpeg, transcription, publishing). Progress is
// persisted so clients can poll /api/jobs/:id.

export interface JobContext {
  id: string;
  progress: (fraction: number, message?: string) => void;
  log: (message: string) => void;
}

export function startJob<T>(
  type: string,
  projectId: string | null,
  work: (ctx: JobContext) => Promise<T>,
  hooks: { onDone?: (result: T) => void; onError?: (err: Error) => void } = {},
): Job {
  const job = createJob(type, projectId);
  const ctx: JobContext = {
    id: job.id,
    progress: (fraction, message) => updateJob(job.id, message === undefined ? { status: "running", progress: fraction } : { status: "running", progress: fraction, message }),
    log: (message) => updateJob(job.id, { message }),
  };
  updateJob(job.id, { status: "running" });
  // Defer so the HTTP response can return the job id first.
  setImmediate(async () => {
    try {
      const result = await work(ctx);
      updateJob(job.id, { status: "done", progress: 1, result: result as unknown, message: "Done" });
      hooks.onDone?.(result);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`[job ${type} ${job.id}] failed:`, e);
      updateJob(job.id, { status: "failed", error: e.message.slice(0, 4000) });
      hooks.onError?.(e);
    }
  });
  return getJob(job.id)!;
}
