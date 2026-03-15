import { describe, it, expect, beforeEach } from "vitest";
import { TaskStore, isValidStatus } from "../store.js";

let store: TaskStore;

beforeEach(() => {
  store = new TaskStore(":memory:");
});

describe("isValidStatus", () => {
  it("accepts valid statuses", () => {
    for (const s of ["pending", "in_progress", "completed", "blocked", "failed", "cancelled"]) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it("rejects invalid statuses", () => {
    expect(isValidStatus("done")).toBe(false);
    expect(isValidStatus("")).toBe(false);
  });
});

describe("TaskStore.assign", () => {
  it("creates a task with defaults", () => {
    const t = store.assign({ assignee: "agent_a", title: "Test task" });
    expect(t.id).toMatch(/^task_/);
    expect(t.assignee).toBe("agent_a");
    expect(t.title).toBe("Test task");
    expect(t.status).toBe("pending");
    expect(t.predecessor_ids).toEqual([]);
    expect(t.successor_ids).toEqual([]);
    expect(t.due_at).toBeNull();
    expect(t.assigned_by).toBeNull();
  });

  it("creates a task with all fields", () => {
    const t = store.assign({
      assignee: "agent_b",
      title: "Full task",
      description: "desc",
      predecessor_ids: ["task_abc"],
      due_at: "2026-12-31T00:00:00Z",
      assigned_by: "ceo",
    });
    expect(t.description).toBe("desc");
    expect(t.predecessor_ids).toEqual(["task_abc"]);
    expect(t.due_at).toBe("2026-12-31T00:00:00Z");
    expect(t.assigned_by).toBe("ceo");
  });

  it("supports custom task_id", () => {
    const t = store.assign({ assignee: "a", title: "t", task_id: "my_id" });
    expect(t.id).toBe("my_id");
  });
});

describe("TaskStore.get", () => {
  it("returns null for non-existent task", () => {
    expect(store.get("nope")).toBeNull();
  });

  it("returns the task by id", () => {
    const t = store.assign({ assignee: "a", title: "t" });
    const got = store.get(t.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(t.id);
  });
});

describe("TaskStore.updateStatus", () => {
  it("updates status to completed", () => {
    const t = store.assign({ assignee: "a", title: "t" });
    const updated = store.updateStatus(t.id, "completed");
    expect(updated!.status).toBe("completed");
    expect(updated!.completed_at).not.toBeNull();
  });

  it("updates status with status_note", () => {
    const t = store.assign({ assignee: "a", title: "t" });
    const updated = store.updateStatus(t.id, "blocked", { status_note: "waiting on API" });
    expect(updated!.status).toBe("blocked");
    expect(updated!.status_note).toBe("waiting on API");
  });

  it("clears completed_at when moving back to in_progress", () => {
    const t = store.assign({ assignee: "a", title: "t" });
    store.updateStatus(t.id, "completed");
    const updated = store.updateStatus(t.id, "in_progress");
    expect(updated!.status).toBe("in_progress");
  });
});

describe("TaskStore.listByAssignee", () => {
  it("returns tasks for a specific assignee", () => {
    store.assign({ assignee: "a", title: "t1" });
    store.assign({ assignee: "b", title: "t2" });
    store.assign({ assignee: "a", title: "t3" });
    expect(store.listByAssignee("a")).toHaveLength(2);
    expect(store.listByAssignee("b")).toHaveLength(1);
    expect(store.listByAssignee("c")).toHaveLength(0);
  });

  it("filters by status", () => {
    const t = store.assign({ assignee: "a", title: "t1" });
    store.assign({ assignee: "a", title: "t2" });
    store.updateStatus(t.id, "completed");
    expect(store.listByAssignee("a", "completed")).toHaveLength(1);
    expect(store.listByAssignee("a", "pending")).toHaveLength(1);
  });
});

describe("TaskStore.listOverdue", () => {
  it("returns overdue tasks", () => {
    store.assign({
      assignee: "a",
      title: "overdue",
      due_at: "2020-01-01T00:00:00Z",
    });
    store.assign({
      assignee: "b",
      title: "future",
      due_at: "2099-01-01T00:00:00Z",
    });
    store.assign({ assignee: "c", title: "no due" });
    const overdue = store.listOverdue();
    expect(overdue).toHaveLength(1);
    expect(overdue[0].title).toBe("overdue");
  });
});

describe("TaskStore.getBlockedTasks", () => {
  it("returns tasks with incomplete predecessors", () => {
    const t1 = store.assign({ assignee: "a", title: "first" });
    store.assign({ assignee: "b", title: "second", predecessor_ids: [t1.id] });
    const blocked = store.getBlockedTasks();
    expect(blocked).toHaveLength(1);
    expect(blocked[0].title).toBe("second");
  });

  it("unblocks when predecessor completes", () => {
    const t1 = store.assign({ assignee: "a", title: "first" });
    store.assign({ assignee: "b", title: "second", predecessor_ids: [t1.id] });
    store.updateStatus(t1.id, "completed");
    expect(store.getBlockedTasks()).toHaveLength(0);
  });
});

describe("TaskStore.getUnblockedPending", () => {
  it("returns tasks with all predecessors completed", () => {
    const t1 = store.assign({ assignee: "a", title: "first" });
    const t2 = store.assign({ assignee: "b", title: "second", predecessor_ids: [t1.id] });
    const t3 = store.assign({ assignee: "c", title: "independent" });

    let unblocked = store.getUnblockedPending();
    const unblockedIds = unblocked.map((t) => t.id);
    expect(unblockedIds).toContain(t1.id);
    expect(unblockedIds).toContain(t3.id);
    expect(unblockedIds).not.toContain(t2.id);

    store.updateStatus(t1.id, "completed");
    unblocked = store.getUnblockedPending();
    expect(unblocked.map((t) => t.id)).toContain(t2.id);
  });
});
