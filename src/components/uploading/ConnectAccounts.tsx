"use client";

import { Check, Link2, Unlink } from "lucide-react";
import { Badge, Button, cx } from "@/components/ui";
import type { PlatformStatus } from "@/lib/publish";

export const PLATFORM_ICON: Record<string, string> = {
  tiktok: "♪",
  instagram: "◎",
  youtube: "▶",
  x: "𝕏",
  linkedin: "in",
};

export function ConnectAccounts({ platforms, onDisconnect, compact }: { platforms: PlatformStatus[]; onDisconnect: (p: string) => void; compact?: boolean }) {
  return (
    <div className={cx("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5")}>
      {platforms.map((p) => (
        <div key={p.platform} className={cx("flex items-center gap-3 rounded-xl border p-3", p.connected ? "border-success/40" : "border-border")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold">{PLATFORM_ICON[p.platform]}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {p.label}
              {p.connected && <Check className="h-3.5 w-3.5 text-success" />}
            </div>
            <div className="truncate text-xs text-muted">
              {p.connected ? p.accountName || "Connected" : p.configured ? "Not connected" : p.via === "ayrshare" ? "Link in Ayrshare" : "Needs app credentials"}
            </div>
          </div>
          {p.via === "native" ? (
            p.connected ? (
              <Button size="sm" variant="ghost" onClick={() => onDisconnect(p.platform)} title="Disconnect">
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <a
                href={`/api/connections/${p.platform}/authorize`}
                className={cx("inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium", p.configured ? "bg-accent text-accent-fg hover:bg-accent-hover" : "pointer-events-none bg-surface-2 text-muted")}
                title={p.configured ? "Connect" : "Set the OAuth client id and secret in the server environment"}
              >
                <Link2 className="h-3.5 w-3.5" /> Connect
              </a>
            )
          ) : (
            <Badge tone={p.connected ? "success" : "muted"}>{p.connected ? "via Ayrshare" : "Ayrshare"}</Badge>
          )}
        </div>
      ))}
    </div>
  );
}
