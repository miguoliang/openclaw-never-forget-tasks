/** 任务与状态模型 */

export const TaskStatus = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

export interface Task {
  id: string;
  assignee: string;
  title: string;
  description: string;
  status: TaskStatusType;
  predecessor_ids: string[];
  successor_ids: string[];
  created_at: string;
  updated_at: string;
  due_at: string | null;
  completed_at: string | null;
  assigned_by: string | null;
  /** 状态为 blocked / failed 时填写的原因，供 CEO 处理后续 */
  status_note: string | null;
  metadata: Record<string, unknown>;
}

export function taskToDict(t: Task): Record<string, unknown> {
  return {
    id: t.id,
    assignee: t.assignee,
    title: t.title,
    description: t.description,
    status: t.status,
    predecessor_ids: t.predecessor_ids,
    successor_ids: t.successor_ids,
    created_at: t.created_at,
    updated_at: t.updated_at,
    due_at: t.due_at,
    completed_at: t.completed_at,
    assigned_by: t.assigned_by,
    status_note: t.status_note,
    metadata: t.metadata,
  };
}

export function taskFromRow(row: Record<string, unknown>): Task {
  const parseList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : JSON.parse(String(v ?? "[]"));
  const parseMeta = (v: unknown): Record<string, unknown> =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  return {
    id: String(row.id),
    assignee: String(row.assignee),
    title: String(row.title),
    description: String(row.description ?? ""),
    status: String(row.status ?? "pending") as TaskStatusType,
    predecessor_ids: Array.isArray(row.predecessor_ids) ? row.predecessor_ids : JSON.parse(String(row.predecessor_ids ?? "[]")),
    successor_ids: Array.isArray(row.successor_ids) ? row.successor_ids : JSON.parse(String(row.successor_ids ?? "[]")),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    due_at: row.due_at != null ? String(row.due_at) : null,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    assigned_by: row.assigned_by != null ? String(row.assigned_by) : null,
    status_note: row.status_note != null ? String(row.status_note) : null,
    metadata: parseMeta(row.metadata ?? "{}"),
  };
}
