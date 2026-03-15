/**
 * MCP Server: exposes "Never Forget Tasks" as MCP Tools for OpenClaw / Cursor / Claude.
 * Uses stdio transport by default. Set OPENCLAW_TASKS_DB env var to specify SQLite path.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import { TaskStore, isValidStatus } from "./store.js";
import { formatReportForAgent } from "./report.js";

const defaultDbPath = join(homedir(), ".openclaw", "openclaw_tasks.db");
const dbPath = process.env.OPENCLAW_TASKS_DB ?? defaultDbPath;
const store = new TaskStore(dbPath);

const server = new McpServer({
  name: "openclaw-never-forget-tasks",
  version: "0.1.0",
}, {
  capabilities: {},
});

// task_assign
server.registerTool(
  "task_assign",
  {
    description: "Assign a task to an agent. Returns the task ID.",
    inputSchema: z.object({
      assignee: z.string().describe("Agent name/ID responsible for this task"),
      title: z.string().describe("Task title"),
      description: z.string().optional().default(""),
      predecessor_ids: z.array(z.string()).optional().default([]),
      due_at_iso: z.string().optional().nullable(),
      assigned_by: z.string().optional().nullable(),
    }),
  },
  async (args) => {
    const t = store.assign({
      assignee: args.assignee,
      title: args.title,
      description: args.description ?? "",
      predecessor_ids: args.predecessor_ids ?? [],
      due_at: args.due_at_iso ?? null,
      assigned_by: args.assigned_by ?? null,
    });
    return {
      content: [{ type: "text" as const, text: `Task [${t.id}] assigned to ${args.assignee}: ${args.title}` }],
    };
  },
);

// task_update_status (only assignee can update; blocked/failed requires status_note)
server.registerTool(
  "task_update_status",
  {
    description:
      "Update task status. Only the assignee (requested_by must match assignee) can update. Valid statuses: pending, in_progress, completed, blocked, failed, cancelled. When setting to blocked or failed, status_note is required.",
    inputSchema: z.object({
      task_id: z.string(),
      status: z.string(),
      requested_by: z.string().describe("Agent name/ID performing the update, must match task assignee"),
      status_note: z
        .string()
        .optional()
        .nullable()
        .describe("Required when status is blocked or failed, explaining the reason"),
    }),
  },
  async (args) => {
    if (!isValidStatus(args.status)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid status: ${args.status}. Valid: pending, in_progress, completed, blocked, failed, cancelled`,
          },
        ],
      };
    }
    const task = store.get(args.task_id);
    if (!task) {
      return { content: [{ type: "text" as const, text: `Task not found: ${args.task_id}` }] };
    }
    if (task.assignee !== args.requested_by) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Permission denied: only assignee ${task.assignee} can update this task, requested_by is ${args.requested_by}`,
          },
        ],
      };
    }
    const needNote = args.status === "blocked" || args.status === "failed";
    const note = args.status_note?.trim() ?? "";
    if (needNote && !note) {
      return {
        content: [
          {
            type: "text" as const,
            text: `status_note is required when setting status to ${args.status}`,
          },
        ],
      };
    }
    const t = store.updateStatus(args.task_id, args.status, {
      status_note: needNote ? note : null,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: t
            ? `Task [${args.task_id}] status updated to ${args.status}` + (needNote && note ? `, reason: ${note}` : "")
            : `Update failed: ${args.task_id}`,
        },
      ],
    };
  },
);

// task_list_by_assignee
server.registerTool(
  "task_list_by_assignee",
  {
    description: "List tasks for a specific agent. Omit status to return all tasks.",
    inputSchema: z.object({
      assignee: z.string(),
      status: z.string().optional().nullable(),
    }),
  },
  async (args) => {
    const status = args.status && isValidStatus(args.status) ? args.status : undefined;
    const tasks = store.listByAssignee(args.assignee, status ?? null);
    if (tasks.length === 0) {
      return { content: [{ type: "text" as const, text: `No tasks for ${args.assignee}` }] };
    }
    const lines = tasks.map((t) => `[${t.id}] ${t.title} | ${t.status}`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// task_get_progress_report
server.registerTool(
  "task_get_progress_report",
  {
    description: "Get a progress report summary (overdue, blocked, by assignee) for CEO Agent periodic review.",
    inputSchema: z.object({
      language: z.string().optional().default("zh"),
    }),
  },
  async (args) => {
    const text = formatReportForAgent(store, { language: args.language ?? "zh" });
    return { content: [{ type: "text" as const, text }] };
  },
);

// task_list_overdue
server.registerTool(
  "task_list_overdue",
  {
    description: "List overdue and incomplete tasks.",
    inputSchema: z.object({}),
  },
  async () => {
    const tasks = store.listOverdue();
    if (tasks.length === 0) {
      return { content: [{ type: "text" as const, text: "No overdue tasks" }] };
    }
    const lines = tasks.map((t) => `[${t.id}] ${t.assignee}: ${t.title} (due: ${t.due_at})`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// task_list_blocked
server.registerTool(
  "task_list_blocked",
  {
    description: "List tasks blocked by incomplete predecessors.",
    inputSchema: z.object({}),
  },
  async () => {
    const tasks = store.getBlockedTasks();
    if (tasks.length === 0) {
      return { content: [{ type: "text" as const, text: "No blocked tasks" }] };
    }
    const lines = tasks.map((t) => `[${t.id}] ${t.assignee}: ${t.title} (depends on: ${t.predecessor_ids.join(", ")})`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// task_get
server.registerTool(
  "task_get",
  {
    description: "Get task details by ID.",
    inputSchema: z.object({
      task_id: z.string(),
    }),
  },
  async (args) => {
    const t = store.get(args.task_id);
    if (!t) {
      return { content: [{ type: "text" as const, text: `Task not found: ${args.task_id}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(t, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("openclaw-never-forget-tasks MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
