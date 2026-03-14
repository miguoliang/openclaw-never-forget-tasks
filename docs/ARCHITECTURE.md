# 项目形态说明：库 / MCP / OpenClaw Plugin

「不能忘任务」适合做成多种形态，取决于你的 CEO Agent 和编排器跑在哪里。当前实现：**TypeScript/Node 库 + MCP Server + OpenClaw Plugin**；OpenClaw 既可配置 MCP 接入，也可直接安装插件使用。

**主要流程序列图**见 [SEQUENCE.md](./SEQUENCE.md)，包含 MCP、OpenClaw 插件、库直接调用三条路径的时序说明。

### 谁负责更新任务状态？

- **分配任务**：由 **CEO Agent** 调用 `task_assign`，把任务派给各 worker agent（assignee）。
- **更新状态**：仅 **被指派的 worker agent** 可更新该任务。调用 `task_update_status` 时必须传 `requested_by`（当前 agent 的 ID），与任务的 `assignee` 一致才会执行，否则返回无权限。
- **失败 / 卡住必须说明原因**：当 worker 将状态设为 `blocked`（卡住）或 `failed`（失败）时，必须填写 `status_note` 说明原因，进度汇报中会展示给 CEO，便于处理后续（改派、取消、重试等）。
- 状态可选：`pending` / `in_progress` / `completed` / `blocked` / `failed` / `cancelled`。

---

## 三种形态对比

| 形态 | 是什么 | 适用场景 |
|------|--------|----------|
| **TypeScript 库** | 当前核心：`TaskStore`、`progressReport`、`formatReportForAgent` 等，被其他 Node/TS 代码直接 `import` 调用 | 编排器/CEO 逻辑用 **Node/TypeScript** 写（脚本、服务、自定义 agent 框架） |
| **MCP Server** | 用 MCP 协议暴露「分配任务、查进度、更新状态」等 **Tools**，供任意 MCP 客户端调用 | **OpenClaw、Cursor、Claude Desktop** 等支持 MCP 的环境；CEO Agent 在 OpenClaw 里通过 MCP 调你 |
| **OpenClaw Plugin** | 在 OpenClaw 里注册 Agent Tools（TypeScript 插件），让平台内的 Agent 直接看到「任务」相关 tool | 希望任务能力**深度集成**到 OpenClaw（例如专属配置、UI、或不用单独起 MCP 进程） |

---

## 推荐：库 + MCP

- **核心**：保持为 **TypeScript 库**（单一事实来源：模型、存储、汇报逻辑）。
- **对外对接**：提供 **MCP Server**（本仓库内 `src/mcp-server.ts`，构建后 `dist/mcp-server.js`），把「分配 / 查询 / 更新 / 进度汇报」暴露成 MCP Tools。
- **在 OpenClaw 里用**：OpenClaw 支持配置 MCP Server，在 `openclaw.json` 里加上本项目的 MCP 即可，CEO Agent 直接调用这些 tools，**不必再写一个 OpenClaw 专用 Plugin**。
- **在 Cursor / Claude 里用**：在各自 MCP 配置里指向同一个 MCP Server，即可在对话里「分配任务、查谁没干完、看进度」。

这样：  
- 只维护一份业务逻辑（TypeScript 库）；  
- 多端复用（OpenClaw、Cursor、Claude 等）；  
- 不必为 OpenClaw 单独维护一份 TypeScript 插件（除非你后面需要插件专属的 UI 或配置）。

---

## 何时考虑 OpenClaw Plugin

在以下情况可以再做一个 **OpenClaw 专用 Plugin**（TypeScript）：

- 需要在 OpenClaw 的配置/控制台里有**任务专属配置**（例如默认 DB 路径、汇报频率）。
- 希望任务以**频道/命令**等形式深度集成（例如 `/tasks` 命令、专属 channel）。
- 不想在 OpenClaw 里配置 MCP，希望「安装一个插件就出现任务 tools」。

Plugin 可以有两种实现方式：

1. **只封装 MCP 客户端**：Plugin 里通过 OpenClaw 的 MCP 客户端去调本项目提供的 MCP Server（逻辑仍在 TypeScript）。
2. **用 HTTP 调你**：你起一个基于本库的小型 HTTP API，Plugin 里用 TypeScript 调这个 API；或 Plugin 内部用 child_process 调 Node 脚本（不推荐，复杂度高）。

通常 **先上 MCP，再按需做 Plugin** 更省事。本仓库已提供 **OpenClaw Plugin**，可直接安装使用。

### 安装与使用 OpenClaw 插件

1. 在仓库根目录构建核心库并安装插件依赖：

```bash
cd openclaw-never-forget-tasks
npm install
npm run build
cd plugin-openclaw
npm install
```

2. 在 OpenClaw 中安装插件（链接方式，无需复制）：

```bash
openclaw plugins install --link /path/to/openclaw-never-forget-tasks/plugin-openclaw
```

3. 启用插件并（可选）在配置中指定任务库路径：

```bash
openclaw plugins enable never-forget-tasks
```

在 OpenClaw 配置中可为插件设置 `dbPath`（与 MCP 共用同一 SQLite 时保持一致）。未配置时使用环境变量 `OPENCLAW_TASKS_DB` 或默认 `openclaw_tasks.db`。

4. 在 Agent 的 `tools.allow` 中允许本插件工具（例如 `never-forget-tasks` 或具体工具名如 `task_assign`、`task_get_progress_report` 等）。

---

## 小结

| 你的需求 | 建议形态 |
|----------|----------|
| 在 OpenClaw 里让 CEO Agent 分配/检查任务 | **MCP Server**（配置 OpenClaw 的 MCP 指向本项目 MCP） |
| 在 Cursor/Claude 里也能用同一套任务 | **MCP Server**（同一份实现，多端复用） |
| 自己的 Node/TS 脚本或服务里记任务、出报表 | **直接用 TypeScript 库**（`TaskStore` + `progressReport`） |
| 要跟 OpenClaw 的配置/UI 深度绑定 | **OpenClaw Plugin**（已提供），内部直接使用本库 |

当前仓库已提供：**库** + **MCP Server** + **OpenClaw Plugin**。OpenClaw 用户可任选：配置 MCP 或安装插件。

### 运行 MCP Server

需要 **Node.js ≥20**，安装依赖后以 stdio 方式运行（供 OpenClaw / Cursor 等连接）：

```bash
npm install
npm run build
export OPENCLAW_TASKS_DB=/path/to/tasks.db   # 可选，默认当前目录 openclaw_tasks.db
node dist/mcp-server.js
```

在 OpenClaw 的 MCP 配置里添加本 Server 的 command/args（例如 `command: "node"`, `args: ["/path/to/openclaw-never-forget-tasks/dist/mcp-server.js"]`），即可在 Agent 中看到并调用 `task_assign`、`task_get_progress_report`、`task_list_overdue`、`task_list_blocked` 等工具。
