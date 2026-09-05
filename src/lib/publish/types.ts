import type { ConnectionRecord } from "@/lib/db/repo";
import type { Platform } from "@/lib/types";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null; // ISO
  accountName?: string | null;
  accountId?: string | null;
  meta?: Record<string, unknown>;
}

export interface PublishInput {
  filePath: string; // absolute path of the rendered mp4
  publicUrl: string; // publicly reachable URL of the same file
  caption: string; // caption text including hashtags
  title: string; // short title (YouTube, TikTok)
  hashtags: string[];
  durationSec?: number;
}

export interface PublishOutput {
  postId: string | null;
  postUrl: string | null;
}

export interface PlatformAdapter {
  platform: Platform;
  label: string;
  configured(): boolean;
  usesPkce?: boolean;
  authorizeUrl(state: string, redirectUri: string, verifier?: string): string;
  exchangeCode(code: string, redirectUri: string, verifier?: string): Promise<TokenSet>;
  refresh?(conn: ConnectionRecord): Promise<TokenSet>;
  publish(conn: ConnectionRecord, input: PublishInput): Promise<PublishOutput>;
}

export class PublishError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}
