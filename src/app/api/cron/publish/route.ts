import { json } from "@/lib/http";
import { processScheduled } from "@/lib/publish/scheduler";

// External cron hook for scheduled posts (the in-process scheduler also runs every 30s).
export async function GET() {
  const processed = await processScheduled();
  return json({ processed });
}

export const POST = GET;
