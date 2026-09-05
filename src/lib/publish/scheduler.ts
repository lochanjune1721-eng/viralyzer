import { listDuePublications } from "@/lib/db/repo";
import type { Platform } from "@/lib/types";
import { runPublications } from "./index";

// Processes scheduled publications. Runs on an interval inside the Node server
// (see src/instrumentation.ts) and can also be triggered by GET /api/cron/publish.

let running = false;

export async function processScheduled(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const due = listDuePublications();
    const byProject = new Map<string, Platform[]>();
    for (const pub of due) {
      if (!byProject.has(pub.projectId)) byProject.set(pub.projectId, []);
      byProject.get(pub.projectId)!.push(pub.platform);
    }
    for (const [projectId, platforms] of byProject) {
      try {
        await runPublications(projectId, platforms);
      } catch (err) {
        console.error("[scheduler] project failed", projectId, err);
      }
    }
    return due.length;
  } finally {
    running = false;
  }
}

declare global {
  var __viralyzerScheduler: NodeJS.Timeout | undefined;
}

export function startScheduler(intervalMs = 30_000): void {
  if (globalThis.__viralyzerScheduler) return;
  globalThis.__viralyzerScheduler = setInterval(() => {
    processScheduled().catch((err) => console.error("[scheduler]", err));
  }, intervalMs);
  globalThis.__viralyzerScheduler.unref?.();
}
