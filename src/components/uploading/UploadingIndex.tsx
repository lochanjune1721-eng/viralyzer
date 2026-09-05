"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Card, useToast } from "@/components/ui";
import { StageIndex } from "@/components/shell/StageIndex";
import type { PlatformStatus } from "@/lib/publish";
import { ConnectAccounts } from "./ConnectAccounts";

// /uploading without a project: account connections live here too, and it is
// where OAuth callbacks land.
export function UploadingIndex() {
  const search = useSearchParams();
  const toast = useToast();
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);

  const load = () => api<{ platforms: PlatformStatus[] }>("/api/connections").then((d) => setPlatforms(d.platforms)).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const c = search.get("connect");
    if (!c) return;
    const ok = search.get("ok");
    const err = search.get("error");
    if (ok) toast.push(`${c} connected${ok !== "connected" ? ` as ${ok}` : ""}`, "success");
    if (err) toast.push(`${c}: ${err}`, "error");
    window.history.replaceState(null, "", window.location.pathname);
  }, [search, toast]);

  return (
    <div>
      <StageIndex stage="uploading" />
      <div className="mx-auto w-full max-w-3xl px-4 pb-10">
        <Card className="p-4">
          <div className="mb-3 text-sm font-medium">Connected accounts</div>
          <ConnectAccounts
            platforms={platforms}
            onDisconnect={async (p) => {
              await api(`/api/connections/${p}`, { method: "DELETE" });
              load();
            }}
          />
        </Card>
      </div>
    </div>
  );
}
