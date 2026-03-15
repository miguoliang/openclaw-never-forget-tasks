/**
 * OpenClaw Plugin: Never Forget Tasks
 * Registers task-related Agent Tools within OpenClaw for CEO Agent to assign/query/update tasks.
 * Uses the same core library (TaskStore, formatReportForAgent) as the MCP Server, sharing the same SQLite DB.
 */

import { join } from "path";
import { homedir } from "os";
import { Type } from "@sinclair/typebox";
import { TaskStore, isValidStatus } from "@miguoliang/openclaw-never-forget-tasks/store";
import { formatReportForAgent } from "@miguoliang/openclaw-never-forget-tasks/report";

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export default function (api: { registerTool: Function; getConfig?: () => Record<string, unknown> }) {
  const config = api.getConfig?.() ?? {};
  const defaultDbPath = join(homedir(), ".openclaw", "openclaw_tasks.db");
  const dbPath =
    (config.dbPath as string) ??
    process.env.OPENCLAW_TASKS_DB ??
    defaultDbPath;
  const store = new TaskStore(dbPath);

  // task_assign
  api.registerTool(
    {
      name: "task_assign",
      description: "Assign a task to an agent. Returns the task ID.",
      parameters: Type.Object({
        assignee: Type.String({ description: "Agent name/ID responsible for this task" }),
        title: Type.String({ description: "Task title" }),
        description: Type.Optional(Type.String()),
        predecessor_ids: Type.Optional(Type.Array(Type.String())),
        due_at_iso: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        assigned_by: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const t = store.assign({
          assignee: params.assignee as string,
          title: params.title as string,
          description: (params.description as string) ?? "",
          predecessor_ids: (params.predecessor_ids as string[]) ?? [],
          due_at: (params.due_at_iso as string | null) ?? null,
          assigned_by: (params.assigned_by as string | null) ?? null,
        });
        return textContent(`Task [${t.id}] assigned to ${params.assignee}: ${params.title}`);
      },
    },
    { optional: true }
  );

  // task_update_status (only assignee can update; blocked/failed requires status_note)
  api.registerTool(
    {
      name: "task_update_status",
      description:
        "Update task status. Only the assignee (requested_by must match assignee) can update. Valid statuses: pending, in_progress, completed, blocked, failed, cancelled. When setting to blocked or failed, status_note is required.",
      parameters: Type.Object({
        task_id: Type.String(),
        status: Type.String(),
        requested_by: Type.String({
          description: "Agent name/ID performing the update, must match task assignee",
        }),
        status_note: Type.Optional(
          Type.Union([Type.String(), Type.Null()], {
            description: "Required when status is blocked or failed, explaining the reason",
          })
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const status = params.status as string;
        if (!isValidStatus(status)) {
          return textContent(
            `Invalid status: ${status}. Valid: pending, in_progress, completed, blocked, failed, cancelled`
          );
        }
        const task = store.get(params.task_id as string);
        if (!task) return textContent(`Task not found: ${params.task_id}`);
        const requestedBy = params.requested_by as string;
        if (task.assignee !== requestedBy) {
          return textContent(
            `Permission denied: only assignee ${task.assignee} can update this task, requested_by is ${requestedBy}`
          );
        }
        const needNote = status === "blocked" || status === "failed";
        const note = (params.status_note as string)?.trim() ?? "";
        if (needNote && !note) {
          return textContent(
            `status_note is required when setting status to ${status}`
          );
        }
        const t = store.updateStatus(params.task_id as string, status, {
          status_note: needNote ? note : null,
        });
        if (!t) return textContent(`Update failed: ${params.task_id}`);
        const suffix = needNote && note ? `, reason: ${note}` : "";
        return textContent(`Task [${params.task_id}] status updated to ${status}${suffix}`);
      },
    },
    { optional: true }
  );

  // task_list_by_assignee
  api.registerTool(
    {
      name: "task_list_by_assignee",
      description:
        "List tasks for a specific agent. Omit status to return all tasks.",
      parameters: Type.Object({
        assignee: Type.String(),
        status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const assignee = params.assignee as string;
        const statusParam = params.status as string | null | undefined;
        const status =
          statusParam && isValidStatus(statusParam) ? statusParam : undefined;
        const tasks = store.listByAssignee(assignee, status ?? null);
        if (tasks.length === 0) return textContent(`No tasks for ${assignee}`);
        const lines = tasks.map((t) => `[${t.id}] ${t.title} | ${t.status}`);
        return textContent(lines.join("\n"));
      },
    },
    { optional: true }
  );

  // task_get_progress_report
  api.registerTool(
    {
      name: "task_get_progress_report",
      description:
        "Get a progress report summary (overdue, blocked, by assignee) for CEO Agent periodic review.",
      parameters: Type.Object({
        language: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const language = (params.language as string) ?? "zh";
        const text = formatReportForAgent(store, { language });
        return textContent(text);
      },
    },
    { optional: true }
  );

  // task_list_overdue
  api.registerTool(
    {
      name: "task_list_overdue",
      description: "List overdue and incomplete tasks.",
      parameters: Type.Object({}),
      async execute() {
        const tasks = store.listOverdue();
        if (tasks.length === 0) return textContent("No overdue tasks");
        const lines = tasks.map(
          (t) => `[${t.id}] ${t.assignee}: ${t.title} (due: ${t.due_at})`
        );
        return textContent(lines.join("\n"));
      },
    },
    { optional: true }
  );

  // task_list_blocked
  api.registerTool(
    {
      name: "task_list_blocked",
      description: "List tasks blocked by incomplete predecessors.",
      parameters: Type.Object({}),
      async execute() {
        const tasks = store.getBlockedTasks();
        if (tasks.length === 0) return textContent("No blocked tasks");
        const lines = tasks.map(
          (t) =>
            `[${t.id}] ${t.assignee}: ${t.title} (depends on: ${t.predecessor_ids.join(", ")})`
        );
        return textContent(lines.join("\n"));
      },
    },
    { optional: true }
  );

  // task_get
  api.registerTool(
    {
      name: "task_get",
      description: "Get task details by ID.",
      parameters: Type.Object({
        task_id: Type.String(),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const t = store.get(params.task_id as string);
        if (!t) return textContent(`Task not found: ${params.task_id}`);
        return textContent(JSON.stringify(t, null, 2));
      },
    },
    { optional: true }
  );
}
