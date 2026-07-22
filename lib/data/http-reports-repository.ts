// Phase 7b (M2): the Supabase-backed `ReportsRepository` implementation --
// a thin fetch client against `app/api/reports*`/`app/api/projects`, which
// validate + call `lib/server/reports-service.ts` server-side. Implements
// `ReportsRepository` (lib/data/reports-repository.ts) VERBATIM -- nothing
// under components/ ever imports this class directly, only
// `getReportsRepository()` (lib/data/index.ts).
//
// No seed-on-first-read here (unlike `LocalStorageReportsRepository`):
// Postgres is seeded once, out-of-band, by `supabase/seed.sql` (applied by
// `supabase db reset`) -- `getAll()`/`getAllDaily()` simply return whatever
// is already in the database. A browser opening this app for the first
// time against an already-seeded project sees the seed data immediately;
// an EMPTY (unseeded) project just returns an empty list, it does not
// self-seed from this class.
//
// **Write queue (mandatory, not an optimization)**: every WRITE method
// (`upsert`/`upsertMany`/`update`/`upsertProject`) is chained through
// `enqueueWrite`, a single promise chain per repository instance. Without
// it, two rapid Kanban drags (or any two near-simultaneous writes from the
// same browser tab) would fire two concurrent `PATCH` requests, each doing
// its own server-side read -> merge -> `replace_reports` round-trip against
// whatever `updated_at` happened to be current when EACH read started --
// the slower request's merge is built on stale data and can silently
// revert the faster request's change on write-back. Serializing writes
// through one chain on the client is the cheapest fix for the same-CLIENT
// race (the one this MVP's "2-10 users, never simultaneous" user base
// actually hits); true optimistic-concurrency across DIFFERENT clients is
// handled server-side instead (`updateReport`'s `expectedUpdatedAt` CAS
// check, lib/server/reports-service.ts) -- not plumbed through this
// repository's interface in Phase 7b (see the Phase 7b plan's "Alternatives
// considered and rejected").

import type { AnyReport, AssignedTask, AssignedTaskPatch, DailyReport, Project, ReportCore, TeamMember, WeeklyReport } from '../types';
import type { ReportsRepository } from './reports-repository';

/** Thrown by every method below on a non-2xx response. `status` is exposed so a future caller (e.g. a share-dialog surfacing a 403 differently from a 500) can branch on it without re-deriving it from `message`. */
export class HttpRepositoryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpRepositoryError';
    this.status = status;
  }
}

async function toHttpError(response: Response): Promise<HttpRepositoryError> {
  let message = `Request failed with status ${response.status}.`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Non-JSON (or empty) error body -- keep the generic message.
  }
  return new HttpRepositoryError(response.status, message);
}

/** `fetch` with this repository's constant options (`cache: 'no-store'` -- route handlers are dynamic anyway via `cookies()`, but this keeps any browser/CDN layer from ever caching a report list; `credentials: 'same-origin'` -- the session lives in first-party cookies, see lib/supabase/server.ts). Throws `HttpRepositoryError` on any non-2xx response; returns `undefined` for a 204. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw await toHttpError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class HttpReportsRepository implements ReportsRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  /** Chains `fn` onto the previous write, regardless of whether that previous write succeeded or failed -- a failed write must never permanently jam the queue for subsequent, unrelated writes. The caller's own returned promise still reflects THEIR write's true outcome. */
  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => fn();
    const scheduled = this.writeQueue.then(run, run);
    this.writeQueue = scheduled.then(
      () => undefined,
      () => undefined
    );
    return scheduled;
  }

  async getAll(): Promise<WeeklyReport[]> {
    const { reports } = await request<{ reports: AnyReport[] }>('/api/reports?kind=weekly');
    return reports as WeeklyReport[];
  }

  async getAllDaily(): Promise<DailyReport[]> {
    const { reports } = await request<{ reports: AnyReport[] }>('/api/reports?kind=daily');
    return reports as DailyReport[];
  }

  async getById(id: string): Promise<AnyReport | null> {
    const response = await fetch(`/api/reports/${encodeURIComponent(id)}`, { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 404) return null;
    if (!response.ok) throw await toHttpError(response);
    const { report } = (await response.json()) as { report: AnyReport };
    return report;
  }

  async upsert(report: AnyReport): Promise<AnyReport> {
    return this.enqueueWrite(async () => {
      await request('/api/reports', { method: 'POST', body: JSON.stringify({ reports: [report] }) });
      return report;
    });
  }

  /** ONE `POST /api/reports` for the whole array -> ONE `replace_reports` RPC call server-side -- see that route handler and CLAUDE.md's "upsertMany must be ONE POST -> ONE replace_reports call -> one transaction" (the Phase 6b data-loss bug class this exists to prevent). */
  async upsertMany(reports: AnyReport[]): Promise<AnyReport[]> {
    if (reports.length === 0) return reports;
    return this.enqueueWrite(async () => {
      await request('/api/reports', { method: 'POST', body: JSON.stringify({ reports }) });
      return reports;
    });
  }

  async update(id: string, patch: Partial<ReportCore>): Promise<AnyReport | null> {
    return this.enqueueWrite(async () => {
      const response = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw await toHttpError(response);
      const { report } = (await response.json()) as { report: AnyReport };
      return report;
    });
  }

  /**
   * Phase 8d (report delete): `DELETE /api/reports/[id]` -> `deleteReport`
   * (lib/server/reports-service.ts), owner-or-admin-gated by `reports_delete`
   * RLS -- children (tasks/risks/priorities) cascade server-side via the FK,
   * so no follow-up requests are needed here. Routed through `enqueueWrite`
   * like every other write in this class, for the same same-client
   * race-avoidance reason documented in this file's header comment (a
   * concurrent PATCH racing this DELETE would otherwise read a pre-delete
   * snapshot and write it right back).
   */
  async deleteReport(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
      await request<void>(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    });
  }

  async getProjects(): Promise<Project[]> {
    const { projects } = await request<{ projects: Project[] }>('/api/projects');
    return projects;
  }

  /**
   * Semantic difference from `LocalStorageReportsRepository.upsertProject`
   * (documented, not a bug): the server-side handler is insert-or-return-
   * EXISTING (`ensureProject`, lib/server/reports-service.ts), never a
   * rename -- `projects_update` RLS is admin-only. Calling this with an
   * `id` that already exists under a DIFFERENT `name` silently returns the
   * EXISTING row's name, not the one just passed in. Every current caller
   * (the CSV importer, Phase 7b M4's localStorage import) only ever calls
   * this to "make sure this project exists," never to rename one, so this
   * is a no-op difference for real call sites today.
   */
  async upsertProject(project: Project): Promise<Project> {
    return this.enqueueWrite(async () => {
      const { project: created } = await request<{ project: Project }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(project),
      });
      return created;
    });
  }

  /**
   * Phase 8c: `PATCH /api/projects/[id]` -> `renameProject`
   * (lib/server/reports-service.ts) -> a `.update({ name })` gated by
   * `projects_update` RLS (admin-only) AND a column-level grant restricting
   * `authenticated`'s UPDATE privilege to `name` alone (supabase/migrations/
   * 20260724000011_project_management.sql) -- both layers unreachable from
   * this client method's request body, which only ever carries `{ name }`
   * by construction (see `ProjectRenameInputSchema`, lib/schema/api.ts).
   * Rejects (via `toHttpError`, curated server-side) on a duplicate name,
   * a non-admin caller, or an unknown id.
   */
  async renameProject(id: string, name: string): Promise<Project> {
    return this.enqueueWrite(async () => {
      const { project } = await request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      return project;
    });
  }

  /**
   * Phase 8c: `DELETE /api/projects/[id]` -> `deleteProject`
   * (lib/server/reports-service.ts), admin-gated by `projects_delete` RLS
   * and blocked at the DB FK layer (`NO ACTION`) if any report/task/risk
   * still references this project -- see that function's doc comment.
   */
  async deleteProject(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
      await request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    });
  }

  async getTeamMembers(): Promise<TeamMember[]> {
    const { members } = await request<{ members: TeamMember[] }>('/api/team');
    return members;
  }

  /**
   * WP1: `POST /api/team` -> `ensureTeamMember` (lib/server/reports-service.ts)
   * -- insert-or-return-existing, never a rename. Semantic difference from
   * `LocalStorageReportsRepository.upsertTeamMember` (documented, not a bug,
   * mirroring `upsertProject`'s identical split): calling this with an `id`
   * that already exists under a DIFFERENT `name`/`role`/`email` silently
   * returns the EXISTING row unchanged, not the values just passed in.
   */
  async upsertTeamMember(member: TeamMember): Promise<TeamMember> {
    return this.enqueueWrite(async () => {
      const { member: created } = await request<{ member: TeamMember }>('/api/team', {
        method: 'POST',
        body: JSON.stringify(member),
      });
      return created;
    });
  }

  /**
   * WP1: `PATCH /api/team/[id]` -> `renameTeamMember` (lib/server/reports-service.ts)
   * -- a `.update({ name })` gated by `team_members_update` RLS (admin-only).
   * Rejects (via `toHttpError`, curated server-side) on a duplicate name, a
   * non-admin caller, or an unknown id.
   */
  async renameTeamMember(id: string, name: string): Promise<TeamMember> {
    return this.enqueueWrite(async () => {
      const { member } = await request<{ member: TeamMember }>(`/api/team/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      return member;
    });
  }

  /**
   * WP1: `DELETE /api/team/[id]` -> `deleteTeamMember` (lib/server/reports-service.ts),
   * admin-gated by `team_members_delete` RLS. No referenced-by-FK check exists
   * yet (see that function's own doc comment) -- a later package adding a
   * task-assignee FK will make this reject with a curated "still assigned"
   * message the same way `deleteProject` already does for projects.
   */
  async deleteTeamMember(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
      await request<void>(`/api/team/${encodeURIComponent(id)}`, { method: 'DELETE' });
    });
  }

  /** WP3 (the access flip): `GET /api/tasks/assigned` -> `list_assigned_tasks()` -- see `ReportsRepository.getAssignedTasks`'s doc comment. */
  async getAssignedTasks(): Promise<AssignedTask[]> {
    const { tasks } = await request<{ tasks: AssignedTask[] }>('/api/tasks/assigned');
    return tasks;
  }

  /** WP3: `PATCH /api/tasks/[id]` -> `update_assigned_task()` (owner-or-assignee, narrow status/deadline/completedAt patch) -- see `ReportsRepository.updateTask`'s doc comment. Routed through `enqueueWrite` like every other write in this class. */
  async updateTask(taskId: string, patch: AssignedTaskPatch): Promise<AssignedTask> {
    return this.enqueueWrite(async () => {
      const { task } = await request<{ task: AssignedTask }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      return task;
    });
  }

  /**
   * SHOULD-FIX 13 fix: resolves once every write queued SO FAR (via
   * `enqueueWrite` above) has settled -- success or failure, mirroring
   * `enqueueWrite`'s own `then(run, run)` never-rejecting-the-chain
   * behavior, so `whenIdle()` itself never rejects even if the write it
   * waited on did. `writeQueue` already tracks exactly this (see the
   * constructor field and `enqueueWrite`'s doc comment) -- this just
   * exposes it publicly. The hooks' `rollback()` (useReports.ts et al.)
   * awaits this before its own `getAll()`/`getAllDaily()`/`getProjects()`
   * read, closing the exact race `enqueueWrite`'s header comment warns
   * about: without it, a rollback triggered by write A's failure could run
   * its refetch WHILE write B (queued right behind A) is still in flight,
   * read server truth from before B landed, and then stomp B's optimistic
   * UI state with that stale read even though B goes on to succeed.
   */
  async whenIdle(): Promise<void> {
    await this.writeQueue;
  }
}
