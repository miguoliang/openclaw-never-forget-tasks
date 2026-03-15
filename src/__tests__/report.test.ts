import { describe, it, expect, beforeEach } from "vitest";
import { TaskStore } from "../store.js";
import { progressReport, formatReportForAgent } from "../report.js";

let store: TaskStore;

beforeEach(() => {
  store = new TaskStore(":memory:");
});

describe("progressReport", () => {
  it("returns empty summary when no tasks", () => {
    const r = progressReport(store, {});
    expect(r.summary.total_open).toBe(0);
    expect(r.summary.overdue_count).toBe(0);
    expect(r.summary.blocked_count).toBe(0);
  });

  it("counts open tasks correctly", () => {
    store.assign({ assignee: "a", title: "t1" });
    store.assign({ assignee: "b", title: "t2" });
    const t3 = store.assign({ assignee: "c", title: "t3" });
    store.updateStatus(t3.id, "completed");

    const r = progressReport(store, {});
    expect(r.summary.total_open).toBe(2);
  });

  it("includes overdue tasks", () => {
    store.assign({ assignee: "a", title: "late", due_at: "2020-01-01T00:00:00Z" });
    const r = progressReport(store, {});
    expect(r.summary.overdue_count).toBe(1);
    expect(r.overdue).toHaveLength(1);
  });

  it("includes blocked tasks", () => {
    const t1 = store.assign({ assignee: "a", title: "first" });
    store.assign({ assignee: "b", title: "second", predecessor_ids: [t1.id] });
    const r = progressReport(store, {});
    expect(r.summary.blocked_count).toBe(1);
  });

  it("groups by assignee", () => {
    store.assign({ assignee: "a", title: "t1" });
    store.assign({ assignee: "a", title: "t2" });
    store.assign({ assignee: "b", title: "t3" });
    const r = progressReport(store, { by_assignee: true });
    expect(r.by_assignee!["a"]).toHaveLength(2);
    expect(r.by_assignee!["b"]).toHaveLength(1);
  });

  it("tracks failed and worker-blocked tasks", () => {
    const t1 = store.assign({ assignee: "a", title: "fail" });
    const t2 = store.assign({ assignee: "b", title: "stuck" });
    store.updateStatus(t1.id, "failed", { status_note: "API down" });
    store.updateStatus(t2.id, "blocked", { status_note: "waiting on vendor" });
    const r = progressReport(store, {});
    expect(r.summary.failed_count).toBe(1);
    expect(r.summary.worker_blocked_count).toBe(1);
  });
});

describe("formatReportForAgent", () => {
  it("generates Chinese report", () => {
    store.assign({ assignee: "a", title: "测试任务" });
    const text = formatReportForAgent(store, { language: "zh" });
    expect(text).toContain("任务进度汇报");
    expect(text).toContain("未完成任务总数: 1");
  });

  it("generates English report", () => {
    store.assign({ assignee: "a", title: "Test task" });
    const text = formatReportForAgent(store, { language: "en" });
    expect(text).toContain("Task Progress Report");
    expect(text).toContain("Total open: 1");
  });

  it("includes overdue section when tasks are overdue", () => {
    store.assign({ assignee: "a", title: "late", due_at: "2020-01-01T00:00:00Z" });
    const text = formatReportForAgent(store, { language: "zh" });
    expect(text).toContain("逾期未完成");
  });

  it("includes failed section with status_note", () => {
    const t = store.assign({ assignee: "a", title: "broken" });
    store.updateStatus(t.id, "failed", { status_note: "服务器挂了" });
    const text = formatReportForAgent(store, { language: "zh" });
    expect(text).toContain("失败任务");
    expect(text).toContain("服务器挂了");
  });
});
