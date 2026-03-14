/**
 * OpenClaw 插件：不能忘任务
 * 在 OpenClaw 内注册任务相关 Agent Tools，供 CEO Agent 分配/查询/更新任务。
 * 使用与 MCP Server 相同的核心库（TaskStore、formatReportForAgent），数据可共用同一 SQLite 库。
 */

import { Type } from "@sinclair/typebox";
import { TaskStore, isValidStatus } from "openclaw-never-forget-tasks/store";
import { formatReportForAgent } from "openclaw-never-forget-tasks/report";

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export default function (api: { registerTool: Function; getConfig?: () => Record<string, unknown> }) {
  const config = api.getConfig?.() ?? {};
  const dbPath =
    (config.dbPath as string) ??
    process.env.OPENCLAW_TASKS_DB ??
    "openclaw_tasks.db";
  const store = new TaskStore(dbPath);

  // task_assign
  api.registerTool(
    {
      name: "task_assign",
      description: "分配一条任务给某个 agent。返回任务 ID。",
      parameters: Type.Object({
        assignee: Type.String({ description: "负责该任务的 agent 名称/ID" }),
        title: Type.String({ description: "任务标题" }),
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
        return textContent(`已分配任务 [${t.id}] 给 ${params.assignee}: ${params.title}`);
      },
    },
    { optional: true }
  );

  // task_update_status（仅 assignee 可更新；blocked/failed 必填 status_note）
  api.registerTool(
    {
      name: "task_update_status",
      description:
        "更新任务状态。仅任务负责人(requested_by 与 assignee 一致)可更新。status 可选: pending, in_progress, completed, blocked, failed, cancelled。设为 blocked 或 failed 时必须填写 status_note 说明原因。",
      parameters: Type.Object({
        task_id: Type.String(),
        status: Type.String(),
        requested_by: Type.String({
          description: "当前执行更新的 agent 名称/ID，必须与任务 assignee 一致",
        }),
        status_note: Type.Optional(
          Type.Union([Type.String(), Type.Null()], {
            description: "状态为 blocked 或 failed 时必填，说明原因",
          })
        ),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const status = params.status as string;
        if (!isValidStatus(status)) {
          return textContent(
            `无效状态: ${status}，可选: pending, in_progress, completed, blocked, failed, cancelled`
          );
        }
        const task = store.get(params.task_id as string);
        if (!task) return textContent(`未找到任务: ${params.task_id}`);
        const requestedBy = params.requested_by as string;
        if (task.assignee !== requestedBy) {
          return textContent(
            `无权限：仅负责人 ${task.assignee} 可更新该任务，当前 requested_by 为 ${requestedBy}`
          );
        }
        const needNote = status === "blocked" || status === "failed";
        const note = (params.status_note as string)?.trim() ?? "";
        if (needNote && !note) {
          return textContent(
            `状态设为 ${status} 时必须填写 status_note 说明原因，便于 CEO 处理后续`
          );
        }
        const t = store.updateStatus(params.task_id as string, status, {
          status_note: needNote ? note : null,
        });
        if (!t) return textContent(`更新失败: ${params.task_id}`);
        const suffix = needNote && note ? `，原因: ${note}` : "";
        return textContent(`任务 [${params.task_id}] 状态已更新为 ${status}${suffix}`);
      },
    },
    { optional: true }
  );

  // task_list_by_assignee
  api.registerTool(
    {
      name: "task_list_by_assignee",
      description:
        "列出某 agent 的任务。status 不传则返回该 agent 全部任务。",
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
        if (tasks.length === 0) return textContent(`${assignee} 暂无任务`);
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
        "获取进度汇报摘要（逾期、阻塞、按负责人未完成），供 CEO Agent 定时查看。",
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
      description: "列出已逾期且未完成的任务。",
      parameters: Type.Object({}),
      async execute() {
        const tasks = store.listOverdue();
        if (tasks.length === 0) return textContent("无逾期任务");
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
      description: "列出因前序未完成而被阻塞的任务。",
      parameters: Type.Object({}),
      async execute() {
        const tasks = store.getBlockedTasks();
        if (tasks.length === 0) return textContent("无被阻塞任务");
        const lines = tasks.map(
          (t) =>
            `[${t.id}] ${t.assignee}: ${t.title} (依赖: ${t.predecessor_ids.join(", ")})`
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
      description: "根据 ID 查询单条任务详情。",
      parameters: Type.Object({
        task_id: Type.String(),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        const t = store.get(params.task_id as string);
        if (!t) return textContent(`未找到任务: ${params.task_id}`);
        return textContent(JSON.stringify(t, null, 2));
      },
    },
    { optional: true }
  );
}
