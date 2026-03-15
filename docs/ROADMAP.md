# 全自动多 Agent 协作工作流：功能补充建议

当前「不能忘任务」已覆盖：任务分配、依赖（前序/后续）、状态更新（含失败/卡住原因）、进度汇报、仅 assignee 可改状态。要支撑**全自动**多 Agent 协作，可从以下方向补充。

---

## 一、当前能力简要对照

| 能力 | 现状 | 对全自动的支撑 |
|------|------|----------------|
| 分配与依赖 | `task_assign`，`predecessor_ids` / `successor_ids` | ✅ 流水线/ DAG 已支持 |
| 状态与权限 | `task_update_status`，仅 assignee + `requested_by` 校验 | ✅ 避免误改、职责清晰 |
| 失败/卡住 | `status_note`，`failed` / `blocked`，汇报中展示 | ✅ CEO 可读原因并决策 |
| 进度视图 | `task_get_progress_report`，逾期/阻塞/按人/失败 | ✅ 定时巡检足够 |
| 单任务查询 | `task_get`，`task_list_by_assignee` | ✅ 工人查自己的任务 |

---

## 二、建议补充的功能（按优先级）

### 1. Worker 侧「可领任务」与认领（高）

**问题**：目前是「CEO 指定 assignee」的推模式；全自动时更常见「工人拉任务」：谁空闲就领下一个可做的。

**建议**：

- **`task_list_claimable`**（或 `task_list_available`）  
  - 入参：可选 `assignee`（只看派给该人的）、可选 `role` / `required_role`（若引入角色）。  
  - 返回：状态为 pending、且前序均已完成的任务（即「可执行」列表），按 `due_at` / `priority` 排序。
- **`task_claim`**（或由「开始做」语义覆盖）  
  - 入参：`task_id`，`requested_by`（当前 agent）。  
  - 逻辑：校验该任务当前无 assignee 或 assignee 与 `requested_by` 一致、且处于 pending、且前序已完成；若可领则置 assignee、状态改为 in_progress。  
  - 若有「角色/技能」字段，可在此校验 `requested_by` 是否具备该任务的 required_role。

**效果**：Worker 只需调「给我可领的任务」+「我领这个」即可自动接单，无需 CEO 事先指定每一个人。

---

### 2. 任务重试与改派（高）

**问题**：任务 `failed` 或长期 `blocked` 后，需要由系统或 CEO 决定「重试」或「换人」，而不是只能新建一条。

**建议**：

- **`task_reassign`**  
  - 入参：`task_id`，`new_assignee`，可选 `reason`（写进 status_note 或 audit）。  
  - 权限：仅 `assigned_by`（CEO）或同一「编排角色」可调；或由 MCP/插件白名单控制。  
  - 逻辑：将 assignee 改为 new_assignee，状态改回 pending（或 in_progress），可选清空 status_note 或追加「改派原因」。
- **`task_retry`**（或合并在 reassign 里）  
  - 入参：`task_id`。  
  - 逻辑：若当前为 failed/blocked，则置为 pending（或 in_progress），清空或保留 status_note 由策略决定。

**效果**：失败/卡住后可闭环「改派或重试」，无需复制任务或手工改库。

---

### 3. 优先级与「下一个该做谁」（中）

**问题**：多条任务都可执行时，需要一致的「谁先谁后」，便于 Worker 与 CEO 都按同一顺序处理。

**建议**：

- 在 Task 上增加 **`priority`**（如整数，越小越优先）。  
- `task_assign` / `task_list_claimable` / `task_get_progress_report` 中：  
  - 可领列表、汇报中的「可执行」列表按 `priority` 升序再 `due_at` 升序排序。  
- 可选：**`task_set_priority`**（仅 CEO/编排可调），用于动态调整顺序。

**效果**：全自动流程下「下一个该做哪条」明确，减少歧义。

---

### 4. 角色/技能与任务匹配（中）

**问题**：多 Agent 时，不同工人能力不同（例如 research / design / code），任务应只对「具备该角色」的 Agent 可见或可领。

**建议**：

- Task 增加 **`required_role`**（或 `tags`：如 `["research","urgent"]`）。  
- Worker 侧：  
  - 在配置或上下文中标明自己的 **role**（如 agent 名即 role，或单独字段）。  
  - `task_list_claimable(assignee?, role?)`：若传了 role，只返回 `required_role` 为空或与 role 匹配的任务。  
- 可选：`task_list_by_role` 供 CEO 查看「某类角色还有哪些未完成」。

**效果**：自动把任务只暴露给能做的 Agent，减少误领和无效调度。

---

### 5. 任务结果/产出与下游输入（中）

**问题**：全自动流水线里，上一环的「产出」（如报告链接、摘要）需传给下一环，否则下游 Agent 只能看到静态 description。

**建议**：

- Task 增加 **`output`**（或 `result`）字段：文本或 JSON（如 `{ "report_url": "...", "summary": "..." }`）。  
- **`task_complete_with_output`**（或扩展 `task_update_status`）：  
  - 当 status 改为 completed 时，可一并写入 output；仅 assignee 可写。  
- 下游任务：  
  - 在 `task_assign` 时可将「前序任务的 output」写入 description 或 metadata；或  
  - 提供 **`task_get_predecessor_outputs`**（task_id）返回前序任务的 output 列表，供 Worker/编排生成下游 description。

**效果**：完成即带产出，下游自动获得输入，便于链式自动化。

---

### 6. 去重与幂等（中）

**问题**：工作流引擎或 CEO 多次触发「创建同一逻辑任务」时，若不幂等会产生重复任务。

**建议**：

- `task_assign` 增加可选 **`idempotency_key`**（或 `external_id`）：  
  - 若传入且已存在相同 key 的任务，则返回已有任务而非新建。  
- 表结构：对 `idempotency_key` 或 `external_id` 建唯一索引（允许 NULL）。

**效果**：重复调用不会重复建任务，便于与外部编排/工作流对接。

---

### 7. 事件/回调与审计（低～中）

**问题**：外部系统（如编排器、监控）需要「任务状态变更」事件；审计需要「谁在何时改了什么」。

**建议**：

- **审计**：  
  - 新增 **task_events** 表（task_id, at, field, old_value, new_value, by）。  
  - 在 `updateStatus`、`assign`、reassign、output 写入等处写事件。  
  - 可选 MCP/插件工具：**`task_get_history`**（task_id）供 CEO 或调试用。
- **事件/回调**：  
  - 配置项：如 `webhook_url` 或 `on_status_change`；在状态/assignee 变更时 POST 一次（payload 含 task_id, status, assignee, timestamp）。  
  - 或仅提供「轮询」：`task_list_recent_changes(since_iso)` 返回某时间后变更过的任务列表，由外部系统轮询。

**效果**：可观测、可回溯，便于全自动流程的监控与排错。

---

### 8. 子任务/分解（低）

**问题**：CEO 或上游有时希望把一大任务拆成多条子任务，并跟踪「父任务完成当且仅当所有子任务完成」。

**建议**：

- Task 增加 **`parent_id`**（可选）。  
- 汇报或查询时：  
  - 若支持「按父聚合」，则 `task_get_progress_report` 可增加「未完成父任务及其未完成子任务数」；  
  - 或提供 **`task_list_children`**（parent_id）。  
- 完成逻辑：当某任务的所有子任务均为 completed 时，可将父任务自动置为 completed（或提供 `task_complete_parent_if_children_done` 工具）。

**效果**：支持层级分解，适合复杂项目或多阶段流水线。

---

## 三、实施顺序建议

| 阶段 | 内容 | 目的 |
|------|------|------|
| **1** | 可领任务列表 + 认领（claim） | Worker 拉取、自动接单，减少对 CEO 逐条指派的依赖 |
| **2** | 改派 + 重试 | 失败/卡住后可闭环，不依赖手工建新任务 |
| **3** | priority + 可选 required_role / output | 顺序明确、角色匹配、上下游传递结果，流水线更顺 |
| **4** | idempotency_key、审计/事件 | 与外部编排对接、可观测与排错 |
| **5** | parent_id / 子任务 | 按需支持更复杂的任务分解 |

---

## 四、小结

当前插件已足够支撑「CEO 派活 + 工人更新状态 + 失败/卡住写原因 + 定时汇报」的半自动协作。要走向**全自动**多 Agent 工作流，优先建议补：

1. **Worker 可领任务 + 认领**（拉模式）。  
2. **改派与重试**（失败/卡住的闭环）。  
3. **优先级与可选角色/产出**（顺序清晰、角色匹配、结果传递）。

其余（幂等、审计、事件、子任务）可按实际编排与运维需求再加。以上能力均可在现有「库 + MCP + 插件」形态上扩展：先加 Store/模型与库 API，再在 MCP 与插件中暴露对应 Tool 即可。
