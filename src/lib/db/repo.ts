import { getDb, parseJson } from "./index";
import { newId, nowIso } from "@/lib/ids";
import {
  type Angle,
  type Connection,
  type EditState,
  type Job,
  type Platform,
  type Project,
  type ProjectStatus,
  type Publication,
  type PublishState,
  type ScriptVariant,
  type TakeRecording,
  type User,
  defaultEditState,
} from "@/lib/types";

type Row = Record<string, unknown>;

// ---------- Users ----------
function rowToUser(r: Row): User {
  return {
    id: String(r.id),
    name: String(r.name),
    handle: (r.handle as string | null) ?? null,
    niche: (r.niche as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

export function getUser(id: string): User | null {
  const r = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToUser(r) : null;
}

export function createUser(partial: Partial<User> = {}): User {
  const user: User = {
    id: partial.id || newId("u"),
    name: partial.name || "Creator",
    handle: partial.handle ?? null,
    niche: partial.niche ?? null,
    createdAt: nowIso(),
  };
  getDb()
    .prepare("INSERT INTO users (id, name, handle, niche, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(user.id, user.name, user.handle, user.niche, user.createdAt);
  return user;
}

export function updateUser(id: string, patch: Partial<Pick<User, "name" | "handle" | "niche">>): User | null {
  const cur = getUser(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  getDb()
    .prepare("UPDATE users SET name = ?, handle = ?, niche = ? WHERE id = ?")
    .run(next.name, next.handle, next.niche, id);
  return next;
}

// ---------- Projects ----------
function rowToProject(r: Row): Project {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title),
    idea: String(r.idea),
    reference: (r.reference as string | null) ?? null,
    stage: String(r.stage) as ProjectStatus,
    angle: parseJson<Angle>(r.angle, {}),
    scripts: parseJson<ScriptVariant[]>(r.scripts, []),
    selectedScriptId: (r.selected_script_id as string | null) ?? null,
    finalScript: (r.final_script as string | null) ?? null,
    takes: parseJson<TakeRecording[]>(r.takes, []),
    edit: { ...defaultEditState(), ...parseJson<Partial<EditState>>(r.edit, {}) },
    publish: parseJson<PublishState>(r.publish, {}),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function listProjects(userId: string, limit = 50): Project[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
    .all(userId, limit) as Row[];
  return rows.map(rowToProject);
}

export function getProject(id: string, userId?: string): Project | null {
  const r = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const p = rowToProject(r);
  if (userId && p.userId !== userId) return null;
  return p;
}

export function createProject(userId: string, input: { idea: string; reference?: string | null; title?: string }): Project {
  const now = nowIso();
  const project: Project = {
    id: newId("p"),
    userId,
    title: input.title || deriveTitle(input.idea, input.reference),
    idea: input.idea,
    reference: input.reference || null,
    stage: "ideation",
    angle: {},
    scripts: [],
    selectedScriptId: null,
    finalScript: null,
    takes: [],
    edit: defaultEditState(),
    publish: {},
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO projects (id, user_id, title, idea, reference, stage, angle, scripts, selected_script_id, final_script, takes, edit, publish, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      project.id,
      project.userId,
      project.title,
      project.idea,
      project.reference,
      project.stage,
      JSON.stringify(project.angle),
      JSON.stringify(project.scripts),
      project.selectedScriptId,
      project.finalScript,
      JSON.stringify(project.takes),
      JSON.stringify(project.edit),
      JSON.stringify(project.publish),
      project.createdAt,
      project.updatedAt,
    );
  return project;
}

export function saveProject(project: Project): Project {
  project.updatedAt = nowIso();
  getDb()
    .prepare(
      `UPDATE projects SET title = ?, idea = ?, reference = ?, stage = ?, angle = ?, scripts = ?, selected_script_id = ?,
       final_script = ?, takes = ?, edit = ?, publish = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      project.title,
      project.idea,
      project.reference,
      project.stage,
      JSON.stringify(project.angle),
      JSON.stringify(project.scripts),
      project.selectedScriptId,
      project.finalScript,
      JSON.stringify(project.takes),
      JSON.stringify(project.edit),
      JSON.stringify(project.publish),
      project.updatedAt,
      project.id,
    );
  return project;
}

/** Re-read, mutate and save atomically-ish (avoids clobbering concurrent job updates). */
export function updateProject(id: string, mutate: (p: Project) => void): Project | null {
  const p = getProject(id);
  if (!p) return null;
  mutate(p);
  return saveProject(p);
}

export function deleteProject(id: string): void {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  getDb().prepare("DELETE FROM publications WHERE project_id = ?").run(id);
}

function deriveTitle(idea: string, reference?: string | null): string {
  const base = (idea || reference || "Untitled").replace(/\s+/g, " ").trim();
  if (base.length <= 60) return base;
  return base.slice(0, 57).replace(/\s+\S*$/, "") + "…";
}

// ---------- Jobs ----------
function rowToJob(r: Row): Job {
  return {
    id: String(r.id),
    projectId: (r.project_id as string | null) ?? null,
    type: String(r.type),
    status: String(r.status) as Job["status"],
    progress: Number(r.progress),
    message: (r.message as string | null) ?? null,
    result: parseJson<unknown>(r.result, null),
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function createJob(type: string, projectId: string | null): Job {
  const now = nowIso();
  const job: Job = {
    id: newId("job"),
    projectId,
    type,
    status: "queued",
    progress: 0,
    message: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      "INSERT INTO jobs (id, project_id, type, status, progress, message, result, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(job.id, job.projectId, job.type, job.status, job.progress, null, null, null, now, now);
  return job;
}

export function getJob(id: string): Job | null {
  const r = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToJob(r) : null;
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, "status" | "progress" | "message" | "result" | "error">>,
): void {
  const cur = getJob(id);
  if (!cur) return;
  // node:sqlite cannot bind `undefined`; treat missing keys as "keep current".
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  getDb()
    .prepare("UPDATE jobs SET status = ?, progress = ?, message = ?, result = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(
      next.status,
      Math.max(0, Math.min(1, Number(next.progress) || 0)),
      next.message ?? null,
      next.result == null ? null : JSON.stringify(next.result),
      next.error ?? null,
      nowIso(),
      id,
    );
}

// ---------- Connections ----------
export interface ConnectionRecord extends Connection {
  accessToken: string;
  refreshToken: string | null;
  meta: Record<string, unknown>;
}

function rowToConnection(r: Row): ConnectionRecord {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    platform: String(r.platform) as Platform,
    accountName: (r.account_name as string | null) ?? null,
    accountId: (r.account_id as string | null) ?? null,
    accessToken: String(r.access_token),
    refreshToken: (r.refresh_token as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    meta: parseJson<Record<string, unknown>>(r.meta, {}),
    createdAt: String(r.created_at),
  };
}

export function listConnections(userId: string): ConnectionRecord[] {
  const rows = getDb().prepare("SELECT * FROM connections WHERE user_id = ?").all(userId) as Row[];
  return rows.map(rowToConnection);
}

export function getConnection(userId: string, platform: Platform): ConnectionRecord | null {
  const r = getDb().prepare("SELECT * FROM connections WHERE user_id = ? AND platform = ?").get(userId, platform) as
    | Row
    | undefined;
  return r ? rowToConnection(r) : null;
}

export function upsertConnection(input: {
  userId: string;
  platform: Platform;
  accountName?: string | null;
  accountId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  meta?: Record<string, unknown>;
}): ConnectionRecord {
  const now = nowIso();
  const existing = getConnection(input.userId, input.platform);
  const id = existing?.id || newId("conn");
  getDb()
    .prepare(
      `INSERT INTO connections (id, user_id, platform, account_name, account_id, access_token, refresh_token, expires_at, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, platform) DO UPDATE SET account_name = excluded.account_name, account_id = excluded.account_id,
       access_token = excluded.access_token, refresh_token = COALESCE(excluded.refresh_token, connections.refresh_token),
       expires_at = excluded.expires_at, meta = excluded.meta, updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.userId,
      input.platform,
      input.accountName ?? null,
      input.accountId ?? null,
      input.accessToken,
      input.refreshToken ?? null,
      input.expiresAt ?? null,
      JSON.stringify({ ...(existing?.meta || {}), ...(input.meta || {}) }),
      existing?.createdAt || now,
      now,
    );
  return getConnection(input.userId, input.platform)!;
}

export function deleteConnection(userId: string, platform: Platform): void {
  getDb().prepare("DELETE FROM connections WHERE user_id = ? AND platform = ?").run(userId, platform);
}

export function toPublicConnection(c: ConnectionRecord): Connection {
  return {
    id: c.id,
    userId: c.userId,
    platform: c.platform,
    accountName: c.accountName,
    accountId: c.accountId,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt,
  };
}

// ---------- OAuth state ----------
export function saveOauthState(state: string, userId: string, platform: Platform, verifier?: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO oauth_states (state, user_id, platform, verifier, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(state, userId, platform, verifier ?? null, nowIso());
  // prune old states
  getDb()
    .prepare("DELETE FROM oauth_states WHERE created_at < ?")
    .run(new Date(Date.now() - 30 * 60 * 1000).toISOString());
}

export function consumeOauthState(state: string): { userId: string; platform: Platform; verifier: string | null } | null {
  const r = getDb().prepare("SELECT * FROM oauth_states WHERE state = ?").get(state) as Row | undefined;
  if (!r) return null;
  getDb().prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  return { userId: String(r.user_id), platform: String(r.platform) as Platform, verifier: (r.verifier as string | null) ?? null };
}

// ---------- Publications ----------
function rowToPublication(r: Row): Publication {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    platform: String(r.platform) as Platform,
    status: String(r.status) as Publication["status"],
    postUrl: (r.post_url as string | null) ?? null,
    postId: (r.post_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    scheduledAt: (r.scheduled_at as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function listPublications(projectId: string): Publication[] {
  const rows = getDb()
    .prepare("SELECT * FROM publications WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Row[];
  return rows.map(rowToPublication);
}

export function getPublication(id: string): Publication | null {
  const r = getDb().prepare("SELECT * FROM publications WHERE id = ?").get(id) as Row | undefined;
  return r ? rowToPublication(r) : null;
}

export function upsertPublication(projectId: string, platform: Platform, patch: Partial<Publication>): Publication {
  const now = nowIso();
  const existing = (getDb()
    .prepare("SELECT * FROM publications WHERE project_id = ? AND platform = ?")
    .get(projectId, platform) as Row | undefined);
  if (existing) {
    const cur = rowToPublication(existing);
    const next = { ...cur, updatedAt: now };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    getDb()
      .prepare(
        "UPDATE publications SET status = ?, post_url = ?, post_id = ?, error = ?, scheduled_at = ?, published_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.status, next.postUrl, next.postId, next.error, next.scheduledAt, next.publishedAt, now, cur.id);
    return next;
  }
  const pub: Publication = {
    id: newId("pub"),
    projectId,
    platform,
    status: patch.status || "scheduled",
    postUrl: patch.postUrl ?? null,
    postId: patch.postId ?? null,
    error: patch.error ?? null,
    scheduledAt: patch.scheduledAt ?? null,
    publishedAt: patch.publishedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      "INSERT INTO publications (id, project_id, platform, status, post_url, post_id, error, scheduled_at, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(pub.id, pub.projectId, pub.platform, pub.status, pub.postUrl, pub.postId, pub.error, pub.scheduledAt, pub.publishedAt, now, now);
  return pub;
}

export function listDuePublications(): Publication[] {
  const rows = getDb()
    .prepare("SELECT * FROM publications WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?")
    .all(nowIso()) as Row[];
  return rows.map(rowToPublication);
}
