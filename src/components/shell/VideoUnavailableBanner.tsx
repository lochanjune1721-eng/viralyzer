"use client";

import { AlertTriangle } from "lucide-react";
import { useApp } from "@/components/shell/AppContext";

// Shown on Shooting / Editing / Uploading when the server cannot process video.
export function VideoUnavailableBanner() {
  const { capabilities } = useApp();
  if (!capabilities || capabilities.video.ok) return null;
  return (
    <div className="mb-5 flex gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div>
        <div className="font-semibold">This deployment cannot process video yet</div>
        <div className="mt-1 text-muted">{capabilities.video.reason}</div>
        <div className="mt-2 text-xs text-muted">
          Scripting and account connections work here. Recording uploads, the cleanup pass, rendering and imports need the Docker deployment described in the README (Render, Railway, Fly.io or any VPS with ffmpeg).
        </div>
      </div>
    </div>
  );
}
