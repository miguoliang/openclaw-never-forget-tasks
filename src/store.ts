/** 任务持久化存储（SQLite） */

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Task, TaskStatusType } from "./models.js";
import { taskFromRow } from "./models.js";

const VALID_STATUSES: TaskStatusType[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "failed",
  "cancelled",
];

export function isValidStatus(s: string): s is TaskStatusType {
  return VALID_STATUSES.includes(s as TaskStatusType);
}

export class TaskStore {
  private db: Database.Database;

  constructor(dbPath: string = "openclaw_tasks.db") {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        assignee TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        predecessor_ids TEXT DEFAULT '[]',
        successor_ids TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        due_at TEXT,
        completed_at TEXT,
        assigned_by TEXT,
        status_note TEXT,
        metadata TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
    `);
    this.migrateStatusNote();
  }

  private migrateStatusNote(): void {
    const info = this.db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    if (!info.some((c) => c.name === "status_note")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN status_note TEXT");
    }
  }

  private isoNow(): string {
    return new Date().toISOString();
  }

  assign(params: {
    assignee: string;
    title: string;
    description?: string;
    predecessor_ids?: string[];
    successor_ids?: string[];
    due_at?: string | null;
    assigned_by?: string | null;
    task_id?: string | null;
    metadata?: Record<string, unknown>;
  }): Task {
    const id = params.task_id ?? `task_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = this.isoNow();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, assignee, title, description, status,
        predecessor_ids, successor_ids,
        created_at, updated_at, due_at, completed_at,
        assigned_by, status_note, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      params.assignee,
      params.title,
      params.description ?? "",
      "pending",
      JSON.stringify(params.predecessor_ids ?? []),
      JSON.stringify(params.successor_ids ?? []),
      now,
      now,
      params.due_at ?? null,
      null,
      params.assigned_by ?? null,
      null,
      JSON.stringify(params.metadata ?? {}),
    );
    return this.get(id)!;
  }

  get(taskId: string): Task | null {
    const row = this.db.prepare(
      "SELECT id, assignee, title, description, status, predecessor_ids, successor_ids, created_at, updated_at, due_at, completed_at, assigned_by, status_note, metadata FROM tasks WHERE id = ?",
    ).get(taskId) as Record<string, unknown> | undefined;
    return row ? taskFromRow(row) : null;
  }

  updateStatus(
    taskId: string,
    status: TaskStatusType,
    options?: { completed_at?: string | null; status_note?: string | null },
  ): Task | null {
    const now = this.isoNow();
    const completed = status === "completed" ? (options?.completed_at ?? now) : null;
    const note = options?.status_note ?? null;
    this.db
      .prepare(
        "UPDATE tasks SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at), status_note = ? WHERE id = ?",
      )
      .run(status, now, completed, note, taskId);
    return this.get(taskId);
  }

  listByAssignee(assignee: string, status?: TaskStatusType | null): Task[] {
    const sql = status
      ? "SELECT * FROM tasks WHERE assignee = ? AND status = ? ORDER BY created_at DESC"
      : "SELECT * FROM tasks WHERE assignee = ? ORDER BY created_at DESC";
    const stmt = this.db.prepare(sql);
    const rows = (status ? stmt.all(assignee, status) : stmt.all(assignee)) as Record<string, unknown>[];
    return rows.map(taskFromRow);
  }

  listPendingOrInProgress(): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks WHERE status IN ('pending', 'in_progress')
         ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at ASC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(taskFromRow);
  }

  listOverdue(): Task[] {
    const now = this.isoNow();
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks WHERE status IN ('pending', 'in_progress') AND due_at IS NOT NULL AND due_at < ? ORDER BY due_at ASC`,
      )
      .all(now) as Record<string, unknown>[];
    return rows.map(taskFromRow);
  }

  listAll(includeCompleted = true): Task[] {
    const sql = includeCompleted
      ? "SELECT * FROM tasks ORDER BY created_at DESC"
      : "SELECT * FROM tasks WHERE status != 'completed' ORDER BY created_at DESC";
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map(taskFromRow);
  }

  getBlockedTasks(): Task[] {
    const open = this.listPendingOrInProgress();
    const all = this.listAll();
    const completedIds = new Set(
      all.filter((t) => t.status === "completed").map((t) => t.id),
    );
    return open.filter(
      (t) =>
        t.predecessor_ids.length > 0 &&
        t.predecessor_ids.some((id) => !completedIds.has(id)),
    );
  }

  getUnblockedPending(): Task[] {
    const open = this.listPendingOrInProgress();
    const all = this.listAll();
    const completedIds = new Set(
      all.filter((t) => t.status === "completed").map((t) => t.id),
    );
    return open.filter(
      (t) =>
        t.predecessor_ids.length === 0 ||
        t.predecessor_ids.every((id) => completedIds.has(id)),
    );
  }
}
