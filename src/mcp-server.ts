/**
 * MCP Server：把「不能忘任务」暴露成 MCP Tools，供 OpenClaw / Cursor / Claude 等调用。
 * 默认使用 stdio；可通过环境变量 OPENCLAW_TASKS_DB 指定 SQLite 路径。
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
    description: "分配一条任务给某个 agent。返回任务 ID。",
    inputSchema: z.object({
      assignee: z.string().describe("负责该任务的 agent 名称/ID"),
      title: z.string().describe("任务标题"),
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
      content: [{ type: "text" as const, text: `已分配任务 [${t.id}] 给 ${args.assignee}: ${args.title}` }],
    };
  },
);

// task_update_status（仅 assignee 可更新自己的任务；设为 blocked/failed 时必填 status_note）
server.registerTool(
  "task_update_status",
  {
    description:
      "更新任务状态。仅任务负责人(requested_by 与 assignee 一致)可更新。status 可选: pending, in_progress, completed, blocked, failed, cancelled。设为 blocked 或 failed 时必须填写 status_note 说明原因，供 CEO 处理后续。",
    inputSchema: z.object({
      task_id: z.string(),
      status: z.string(),
      requested_by: z.string().describe("当前执行更新的 agent 名称/ID，必须与任务 assignee 一致"),
      status_note: z
        .string()
        .optional()
        .nullable()
        .describe("状态为 blocked 或 failed 时必填，说明原因"),
    }),
  },
  async (args) => {
    if (!isValidStatus(args.status)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `无效状态: ${args.status}，可选: pending, in_progress, completed, blocked, failed, cancelled`,
          },
        ],
      };
    }
    const task = store.get(args.task_id);
    if (!task) {
      return { content: [{ type: "text" as const, text: `未找到任务: ${args.task_id}` }] };
    }
    if (task.assignee !== args.requested_by) {
      return {
        content: [
          {
            type: "text" as const,
            text: `无权限：仅负责人 ${task.assignee} 可更新该任务，当前 requested_by 为 ${args.requested_by}`,
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
            text: `状态设为 ${args.status} 时必须填写 status_note 说明原因，便于 CEO 处理后续`,
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
            ? `任务 [${args.task_id}] 状态已更新为 ${args.status}` + (needNote && note ? `，原因: ${note}` : "")
            : `更新失败: ${args.task_id}`,
        },
      ],
    };
  },
);

// task_list_by_assignee
server.registerTool(
  "task_list_by_assignee",
  {
    description: "列出某 agent 的任务。status 不传则返回该 agent 全部任务。",
    inputSchema: z.object({
      assignee: z.string(),
      status: z.string().optional().nullable(),
    }),
  },
  async (args) => {
    const status = args.status && isValidStatus(args.status) ? args.status : undefined;
    const tasks = store.listByAssignee(args.assignee, status ?? null);
    if (tasks.length === 0) {
      return { content: [{ type: "text" as const, text: `${args.assignee} 暂无任务` }] };
    }
    const lines = tasks.map((t) => `[${t.id}] ${t.title} | ${t.status}`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// task_get_progress_report
server.registerTool(
  "task_get_progress_report",
  {
    description: "获取进度汇报摘要（逾期、阻塞、按负责人未完成），供 CEO Agent 定时查看。",
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
    description: "列出已逾期且未完成的任务。",
    inputSchema: z.object({}),
  },
  async () => {
    const tasks = store.listOverdue();
    if (tasks.length === 0) {
      return { content: [{ type: "text" as const, text: "无逾期任务" }] };
    }
    const lines = tasks.map((t) => `[${t.id}] ${t.assignee}: ${t.title} (due: ${t.due_at})`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// task_list_blocked
server.registerTool(
  "task_list_blocked",
  {
    description: "列出因前序未完成而被阻塞的任务。",
    inputSchema: z.object({}),
  },
  async () => {
    const tasks = store.getBlockedTasks();
    if (tasks.length === 0) {
      return { content: [{ type: "text" as const, text: "无被阻塞任务" }] };
    }
    const lines = tasks.map((t) => `[${t.id}] ${t.assignee}: ${t.title} (依赖: ${t.predecessor_ids.join(", ")})`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// task_get
server.registerTool(
  "task_get",
  {
    description: "根据 ID 查询单条任务详情。",
    inputSchema: z.object({
      task_id: z.string(),
    }),
  },
  async (args) => {
    const t = store.get(args.task_id);
    if (!t) {
      return { content: [{ type: "text" as const, text: `未找到任务: ${args.task_id}` }] };
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
