/** Progress summary and reporting (for CEO Agent periodic review) */

import type { TaskStore } from "./store.js";
import { taskToDict } from "./models.js";

export interface ProgressReport {
  generated_at: string;
  summary: {
    total_open: number;
    overdue_count: number;
    blocked_count: number;
    unblocked_pending_count: number;
    failed_count: number;
    worker_blocked_count: number;
  };
  overdue_task_ids: string[];
  blocked_task_ids: string[];
  overdue: Record<string, unknown>[];
  blocked: Record<string, unknown>[];
  unblocked_pending: Record<string, unknown>[];
  failed: Record<string, unknown>[];
  worker_blocked: Record<string, unknown>[];
  by_assignee?: Record<string, Record<string, unknown>[]>;
  assignees_with_open_tasks?: string[];
}

export function progressReport(
  store: TaskStore,
  options: {
    by_assignee?: boolean;
    include_overdue?: boolean;
    include_blocked?: boolean;
    include_unfinished_only?: boolean;
  } = {},
): ProgressReport {
  const {
    by_assignee = true,
    include_overdue = true,
    include_blocked = true,
    include_unfinished_only = true,
  } = options;

  const openTasks = include_unfinished_only
    ? store.listPendingOrInProgress()
    : store
        .listAll(true)
        .filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const overdue = include_overdue ? store.listOverdue() : [];
  const blocked = include_blocked ? store.getBlockedTasks() : [];
  const unblocked = store.getUnblockedPending();
  const all = store.listAll(true);
  const failed = all.filter((t) => t.status === "failed");
  const workerBlocked = all.filter((t) => t.status === "blocked");

  const report: ProgressReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total_open: openTasks.length,
      overdue_count: overdue.length,
      blocked_count: blocked.length,
      unblocked_pending_count: unblocked.length,
      failed_count: failed.length,
      worker_blocked_count: workerBlocked.length,
    },
    overdue_task_ids: overdue.map((t) => t.id),
    blocked_task_ids: blocked.map((t) => t.id),
    overdue: overdue.map((t) => taskToDict(t)),
    blocked: blocked.map((t) => taskToDict(t)),
    unblocked_pending: unblocked.map((t) => taskToDict(t)),
    failed: failed.map((t) => taskToDict(t)),
    worker_blocked: workerBlocked.map((t) => taskToDict(t)),
  };

  if (by_assignee) {
    const byAgent: Record<string, Record<string, unknown>[]> = {};
    for (const t of openTasks) {
      const d = taskToDict(t);
      if (!byAgent[t.assignee]) byAgent[t.assignee] = [];
      byAgent[t.assignee].push(d);
    }
    report.by_assignee = byAgent;
    report.assignees_with_open_tasks = Object.keys(byAgent);
  }

  return report;
}

export function formatReportForAgent(
  store: TaskStore,
  options: {
    language?: string;
    max_overdue?: number;
    max_blocked?: number;
    max_failed?: number;
    max_worker_blocked?: number;
  } = {},
): string {
  const { max_overdue = 20, max_blocked = 20 } = options;
  const r = progressReport(store, {
    by_assignee: true,
    include_overdue: true,
    include_blocked: true,
    include_unfinished_only: true,
  });

  const maxFailed = options.max_failed ?? 20;
  const maxWorkerBlocked = options.max_worker_blocked ?? 20;

  const lines = [
    "[Task Progress Report]",
    `Generated: ${r.generated_at}`,
    "",
    "Summary:",
    `  - Total open: ${r.summary.total_open}`,
    `  - Overdue: ${r.summary.overdue_count}`,
    `  - Blocked (dependency): ${r.summary.blocked_count}`,
    `  - Unblocked pending: ${r.summary.unblocked_pending_count}`,
    `  - Failed / worker-blocked: ${r.summary.failed_count} failed, ${r.summary.worker_blocked_count} marked blocked`,
    "",
  ];
  if (r.overdue.length > 0) {
    lines.push("Overdue (priority attention needed):");
    for (const t of r.overdue.slice(0, max_overdue)) {
      lines.push(`  - [${t.id}] ${t.assignee}: ${t.title} (due: ${t.due_at ?? "none"})`);
    }
    if (r.overdue.length > max_overdue) lines.push(`  ... ${r.overdue.length} total`);
    lines.push("");
  }
  if (r.blocked.length > 0) {
    lines.push("Blocked (waiting on predecessors):");
    for (const t of r.blocked.slice(0, max_blocked)) {
      const pred = (t.predecessor_ids as string[] | undefined)?.join(", ") ?? "";
      lines.push(`  - [${t.id}] ${t.assignee}: ${t.title} (depends on: ${pred})`);
    }
    if (r.blocked.length > max_blocked) lines.push(`  ... ${r.blocked.length} total`);
    lines.push("");
  }
  if (r.failed.length > 0) {
    lines.push("Failed (need CEO follow-up):");
    for (const t of r.failed.slice(0, maxFailed)) {
      const note = (t.status_note as string) || "(no reason given)";
      lines.push(`  - [${t.id}] ${t.assignee}: ${t.title}`);
      lines.push(`    Reason: ${note}`);
    }
    if (r.failed.length > maxFailed) lines.push(`  ... ${r.failed.length} total`);
    lines.push("");
  }
  if (r.worker_blocked.length > 0) {
    lines.push("Marked blocked (need CEO follow-up):");
    for (const t of r.worker_blocked.slice(0, maxWorkerBlocked)) {
      const note = (t.status_note as string) || "(no reason given)";
      lines.push(`  - [${t.id}] ${t.assignee}: ${t.title}`);
      lines.push(`    Reason: ${note}`);
    }
    if (r.worker_blocked.length > maxWorkerBlocked) lines.push(`  ... ${r.worker_blocked.length} total`);
    lines.push("");
  }
  lines.push("By assignee:");
  for (const [assignee, tasks] of Object.entries(r.by_assignee ?? {})) {
    lines.push(`  ${assignee}: ${tasks.length} task(s)`);
    for (const t of tasks.slice(0, 5)) {
      lines.push(`    - [${t.id}] ${t.title} | ${t.status}`);
    }
    if (tasks.length > 5) lines.push(`    ... ${tasks.length} total`);
  }
  return lines.join("\n");
}
