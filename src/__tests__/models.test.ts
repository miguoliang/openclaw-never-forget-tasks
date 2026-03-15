import { describe, it, expect } from "vitest";
import { taskFromRow, taskToDict } from "../models.js";

describe("taskFromRow", () => {
  it("parses a minimal row", () => {
    const row = {
      id: "task_123",
      assignee: "agent_a",
      title: "Test",
      description: "",
      status: "pending",
      predecessor_ids: "[]",
      successor_ids: "[]",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      due_at: null,
      completed_at: null,
      assigned_by: null,
      status_note: null,
      metadata: "{}",
    };
    const t = taskFromRow(row);
    expect(t.id).toBe("task_123");
    expect(t.predecessor_ids).toEqual([]);
    expect(t.metadata).toEqual({});
  });

  it("parses JSON string metadata", () => {
    const row = {
      id: "t1",
      assignee: "a",
      title: "t",
      description: "",
      status: "pending",
      predecessor_ids: '["dep1"]',
      successor_ids: "[]",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      due_at: null,
      completed_at: null,
      assigned_by: null,
      status_note: null,
      metadata: '{"key":"value"}',
    };
    const t = taskFromRow(row);
    expect(t.predecessor_ids).toEqual(["dep1"]);
    expect(t.metadata).toEqual({ key: "value" });
  });

  it("handles already-parsed arrays", () => {
    const row = {
      id: "t1",
      assignee: "a",
      title: "t",
      predecessor_ids: ["dep1", "dep2"],
      successor_ids: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      metadata: { foo: "bar" },
    };
    const t = taskFromRow(row);
    expect(t.predecessor_ids).toEqual(["dep1", "dep2"]);
    expect(t.metadata).toEqual({ foo: "bar" });
  });
});

describe("taskToDict", () => {
  it("converts a task to a plain object", () => {
    const task = taskFromRow({
      id: "t1",
      assignee: "a",
      title: "test",
      description: "desc",
      status: "pending",
      predecessor_ids: "[]",
      successor_ids: "[]",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      due_at: null,
      completed_at: null,
      assigned_by: "ceo",
      status_note: null,
      metadata: "{}",
    });
    const d = taskToDict(task);
    expect(d.id).toBe("t1");
    expect(d.assigned_by).toBe("ceo");
  });
});
