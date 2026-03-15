# Full-Auto Multi-Agent Collaboration: Feature Roadmap

The current "Never Forget Tasks" covers: task assignment, dependencies (predecessors/successors), status updates (with failure/blocked reasons), progress reporting, and assignee-only status updates. To support **fully automated** multi-agent collaboration, consider the following enhancements.

---

## Current Capabilities

| Capability | Status | Support for Full-Auto |
|-----------|--------|----------------------|
| Assignment & dependencies | `task_assign`, `predecessor_ids` / `successor_ids` | ✅ Pipeline/DAG supported |
| Status & permissions | `task_update_status`, assignee + `requested_by` validation | ✅ Prevents accidental changes, clear ownership |
| Failure/blocked | `status_note`, `failed` / `blocked`, shown in reports | ✅ CEO can read reason and decide |
| Progress views | `task_get_progress_report`, overdue/blocked/by-assignee/failed | ✅ Sufficient for periodic checks |
| Single task query | `task_get`, `task_list_by_assignee` | ✅ Workers check their own tasks |

---

## Suggested Enhancements (by Priority)

### 1. Worker-Side "Claimable Tasks" & Claiming (High)

**Problem**: Currently uses a "CEO assigns assignee" push model; full-auto more commonly needs "worker pulls tasks": whoever is idle claims the next available one.

**Suggestion**:

- **`task_list_claimable`** (or `task_list_available`)
  - Input: optional `assignee` (only show tasks assigned to them), optional `role` / `required_role` (if roles are introduced).
  - Returns: tasks with `pending` status and all predecessors completed ("ready" list), sorted by `due_at` / `priority`.
- **`task_claim`** (or covered by a "start working" semantic)
  - Input: `task_id`, `requested_by` (current agent).
  - Logic: verify task has no assignee or assignee matches `requested_by`, status is pending, predecessors complete; if claimable, set assignee and status to `in_progress`.
  - If roles/skills exist, validate `requested_by` has the task's `required_role`.

**Effect**: Workers just call "give me claimable tasks" + "I'll take this one" for automatic task pickup, no CEO per-task assignment needed.

---

### 2. Retry & Reassignment (High)

**Problem**: When a task is `failed` or stuck `blocked`, the system or CEO needs to "retry" or "reassign" rather than creating a new task.

**Suggestion**:

- **`task_reassign`**
  - Input: `task_id`, `new_assignee`, optional `reason` (written to status_note or audit).
  - Permissions: only `assigned_by` (CEO) or same orchestration role can call; or controlled by MCP/plugin allowlist.
  - Logic: change assignee to new_assignee, reset status to pending (or in_progress), optionally clear or append to status_note.
- **`task_retry`** (or merged into reassign)
  - Input: `task_id`.
  - Logic: if currently failed/blocked, set to pending (or in_progress), clear or keep status_note per policy.

**Effect**: Closed-loop handling of failure/blocked without duplicating tasks or manual DB edits.

---

### 3. Priority & "What to Do Next" (Medium)

**Problem**: When multiple tasks are ready, a consistent "who goes first" is needed so workers and CEO follow the same order.

**Suggestion**:

- Add **`priority`** field to Task (integer, lower = higher priority).
- In `task_assign` / `task_list_claimable` / `task_get_progress_report`: sort ready lists by `priority` ASC then `due_at` ASC.
- Optional: **`task_set_priority`** (CEO/orchestrator only) for dynamic reordering.

**Effect**: Clear "what to do next" in full-auto workflows, less ambiguity.

---

### 4. Roles/Skills & Task Matching (Medium)

**Problem**: With multiple agents, different workers have different capabilities (e.g., research / design / code). Tasks should only be visible/claimable by agents with the right role.

**Suggestion**:

- Add **`required_role`** (or `tags`: e.g., `["research","urgent"]`) to Task.
- Worker side: agent declares its **role** in config or context.
- `task_list_claimable(assignee?, role?)`: if role is provided, only return tasks where `required_role` is empty or matches.
- Optional: `task_list_by_role` for CEO to see "what's incomplete for a given role".

**Effect**: Tasks are only exposed to capable agents, reducing misassignment and wasted scheduling.

---

### 5. Task Output & Downstream Input (Medium)

**Problem**: In full-auto pipelines, upstream task output (e.g., report link, summary) needs to be passed to the next stage. Otherwise downstream agents only see static descriptions.

**Suggestion**:

- Add **`output`** (or `result`) field to Task: text or JSON (e.g., `{ "report_url": "...", "summary": "..." }`).
- **`task_complete_with_output`** (or extend `task_update_status`): when status changes to completed, write output; only assignee can write.
- Downstream tasks: write predecessor outputs into description or metadata during `task_assign`; or provide **`task_get_predecessor_outputs`**(task_id) returning predecessor output list.

**Effect**: Completion carries output, downstream automatically gets input — enables chain automation.

---

### 6. Deduplication & Idempotency (Medium)

**Problem**: When workflow engines or CEO trigger "create same logical task" multiple times, non-idempotent creation produces duplicate tasks.

**Suggestion**:

- `task_assign` adds optional **`idempotency_key`** (or `external_id`):
  - If provided and a task with the same key exists, return existing task instead of creating new.
- Schema: add unique index on `idempotency_key` or `external_id` (allow NULL).

**Effect**: Repeated calls don't create duplicate tasks — easier integration with external orchestrators/workflows.

---

### 7. Events/Callbacks & Audit (Low-Medium)

**Problem**: External systems (orchestrators, monitors) need "task status changed" events; audit needs "who changed what when".

**Suggestion**:

- **Audit**:
  - New **task_events** table (task_id, at, field, old_value, new_value, by).
  - Write events on `updateStatus`, `assign`, reassign, output writes, etc.
  - Optional tool: **`task_get_history`**(task_id) for CEO or debugging.
- **Events/Callbacks**:
  - Config: e.g., `webhook_url` or `on_status_change`; POST on status/assignee change (payload: task_id, status, assignee, timestamp).
  - Or polling only: `task_list_recent_changes(since_iso)` returns tasks changed after a given time.

**Effect**: Observable and traceable — essential for full-auto workflow monitoring and debugging.

---

### 8. Subtasks / Decomposition (Low)

**Problem**: CEO or upstream may want to split a large task into subtasks, tracking "parent completes only when all children complete".

**Suggestion**:

- Add optional **`parent_id`** to Task.
- Reporting/querying: if parent aggregation is supported, `task_get_progress_report` can add "incomplete parent tasks with their incomplete child count"; or provide **`task_list_children`**(parent_id).
- Completion logic: when all children of a task are completed, auto-complete parent (or provide `task_complete_parent_if_children_done` tool).

**Effect**: Supports hierarchical decomposition for complex projects or multi-stage pipelines.

---

## Implementation Order

| Phase | Content | Purpose |
|-------|---------|---------|
| **1** | Claimable task list + claim | Workers pull tasks, auto-pickup, less dependency on CEO per-task assignment |
| **2** | Reassignment + retry | Closed-loop for failure/blocked, no need to duplicate tasks |
| **3** | Priority + optional required_role / output | Clear ordering, role matching, upstream-downstream result passing |
| **4** | Idempotency key, audit/events | External orchestrator integration, observability and debugging |
| **5** | parent_id / subtasks | Support complex task decomposition as needed |

---

## Summary

The current plugin fully supports "CEO assigns tasks + workers update status + failure/blocked with reasons + periodic reporting" for semi-auto collaboration. To move toward **full-auto** multi-agent workflows, prioritize:

1. **Worker claimable tasks + claiming** (pull model).
2. **Reassignment and retry** (closed-loop for failures).
3. **Priority and optional roles/output** (clear ordering, role matching, result passing).

The rest (idempotency, audit, events, subtasks) can be added based on actual orchestration and operations needs. All capabilities can be extended on the existing "library + MCP + plugin" architecture: add Store/model and library API first, then expose the corresponding Tools in MCP and plugin.
