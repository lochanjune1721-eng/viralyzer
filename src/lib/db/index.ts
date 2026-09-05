import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

// Single process-wide SQLite connection (Next dev hot-reloads modules, so it is
// cached on globalThis).
declare global {
  var __viralyzerDb: DatabaseSync | undefined;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    handle TEXT,
    niche TEXT,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    idea TEXT NOT NULL,
    reference TEXT,
    stage TEXT NOT NULL,
    angle TEXT NOT NULL DEFAULT '{}',
    scripts TEXT NOT NULL DEFAULT '[]',
    selected_script_id TEXT,
    final_script TEXT,
    takes TEXT NOT NULL DEFAULT '[]',
    edit TEXT NOT NULL DEFAULT '{}',
    publish TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    account_name TEXT,
    account_id TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, platform)
  );`,
  `CREATE TABLE IF NOT EXISTS publications (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    post_url TEXT,
    post_id TEXT,
    error TEXT,
    scheduled_at TEXT,
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_publications_project ON publications(project_id);`,
  `CREATE INDEX IF NOT EXISTS idx_publications_sched ON publications(status, scheduled_at);`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    verifier TEXT,
    created_at TEXT NOT NULL
  );`,
];

export function getDb(): DatabaseSync {
  if (globalThis.__viralyzerDb) return globalThis.__viralyzerDb;
  fs.mkdirSync(env.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(env.dataDir, "viralyzer.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const sql of MIGRATIONS) db.exec(sql);
  globalThis.__viralyzerDb = db;
  return db;
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
