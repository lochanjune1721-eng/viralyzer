import { ffmpegPath } from "./ffmpeg";

// Whether this server can actually process video. Serverless hosts (Vercel)
// have no ffmpeg, a read-only project directory and no background workers, so
// the Shooting uploads, Editing pipeline and renders cannot run there.
export interface VideoCapability {
  ok: boolean;
  reason: string | null;
  host: "serverless" | "server";
}

let cached: VideoCapability | null = null;

export function videoCapability(): VideoCapability {
  if (cached) return cached;
  const serverless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.NETLIFY;
  let hasFfmpeg = true;
  try {
    ffmpegPath();
  } catch {
    hasFfmpeg = false;
  }
  if (serverless) {
    cached = {
      ok: false,
      host: "serverless",
      reason: "This deployment runs on a serverless host (Vercel), which has no ffmpeg, no persistent storage and no background workers. Deploy the Docker image (Railway, Fly.io, Render or any VPS) to record, edit and render video.",
    };
  } else if (!hasFfmpeg) {
    cached = { ok: false, host: "server", reason: "ffmpeg is not installed on this server. Install it (or set FFMPEG_PATH) to record, edit and render video." };
  } else {
    cached = { ok: true, host: "server", reason: null };
  }
  return cached;
}

/** Throw a user-facing error when video work is requested on a host that cannot do it. */
export function requireVideoProcessing(): void {
  const cap = videoCapability();
  if (!cap.ok) throw new Error(cap.reason || "Video processing is unavailable on this server");
}
