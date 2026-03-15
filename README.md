# openclaw-never-forget-tasks

**多 Agent 场景下的任务记录与进度跟踪**（不能忘任务）—— TypeScript + Node，提供 **MCP Server** 与 **OpenClaw 插件**两种形态，适用于 CEO Agent 管理多个分工明确的 Agent。

## 功能

- **记录「谁要干什么」**：CEO 给各 Agent 派活时写入任务（负责人、标题、描述、截止时间等）
- **前序 / 后续任务**：支持 `predecessor_ids` / `successor_ids`，表达依赖与流水线
- **定时检查**：CEO 可定时拉取「未完成」「逾期」「被阻塞」「可执行」等视图
- **进度汇报**：`progressReport()` 与 `formatReportForAgent()` 生成可读摘要，便于汇报与决策

## 技术栈

- **TypeScript** + **Node.js**（≥20）
- **SQLite**（better-sqlite3）
- **MCP**（@modelcontextprotocol/sdk）：以 stdio 暴露 Tools，供 OpenClaw、Cursor、Claude 等调用

## 安装与运行

```bash
git clone https://github.com/miguoliang/openclaw-never-forget-tasks.git
cd openclaw-never-forget-tasks
npm install
```

### 作为 MCP Server 运行（stdio）

```bash
# 开发
npm run mcp
# 或构建后
npm run build && node dist/mcp-server.js
```

可通过环境变量 `OPENCLAW_TASKS_DB` 指定 SQLite 文件路径（默认当前目录 `openclaw_tasks.db`）。

在 **OpenClaw** 的 MCP 配置中增加本 Server，例如：

```json
{
  "mcp": {
    "servers": {
      "never-forget-tasks": {
        "command": "node",
        "args": ["/path/to/openclaw-never-forget-tasks/dist/mcp-server.js"]
      }
    }
  }
}
```

在 **Cursor** 等客户端的 MCP 配置里同样指向上述 `command` + `args` 即可。

### 作为 OpenClaw 插件使用（推荐 OpenClaw 用户）

无需单独起 MCP 进程，在 OpenClaw 内安装插件即可让 Agent 使用同一套任务工具：

```bash
# 在仓库根目录
npm install && npm run build
cd plugin-openclaw && npm install

# 安装并启用插件（--link 表示链接本地目录）
openclaw plugins install --link /path/to/openclaw-never-forget-tasks/plugin-openclaw
openclaw plugins enable never-forget-tasks
```

在 Agent 的 `tools.allow` 中加入 `never-forget-tasks` 或具体工具名。可选：在 OpenClaw 插件配置中设置 `dbPath`，与 MCP 共用同一 SQLite 时保持一致；未设置时使用环境变量 `OPENCLAW_TASKS_DB` 或默认 `openclaw_tasks.db`。

#### 如何试运行插件（一步步）

**前置**：本机已安装 [OpenClaw](https://docs.openclaw.ai) 且能执行 `openclaw` 命令；Node.js ≥ 20。

1. **构建并安装插件依赖**

```bash
cd /path/to/openclaw-never-forget-tasks
npm install && npm run build
cd plugin-openclaw && npm install
```

2. **用链接方式安装插件（不复制文件，改代码即生效）**

```bash
openclaw plugins install --link /path/to/openclaw-never-forget-tasks/plugin-openclaw
openclaw plugins enable never-forget-tasks
```

3. **确认插件已加载**

```bash
openclaw plugins list
openclaw plugins doctor
```

列表中应能看到 `never-forget-tasks` 且无报错。

4. **让 Agent 能用任务工具**

在 OpenClaw 的配置里（如项目下的 `openclaw.json` 或全局配置）给要用任务能力的 agent 加上工具白名单。例如允许该插件下所有工具：

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": ["never-forget-tasks"]
        }
      }
    ]
  }
}
```

也可只开放具体工具名：`["task_assign", "task_get_progress_report", "task_list_by_assignee", "task_update_status", "task_get", "task_list_overdue", "task_list_blocked"]`。

5. **启动 OpenClaw 并对话验证**

启动 OpenClaw（如 `openclaw start` 或你当前的启动方式），在对话里让 Agent 执行：  
「帮我给 agent_research 分配一个任务：标题是《试运行任务》，描述随便写。」  
然后再说：「查一下当前任务进度汇报。」  
若配置正确，Agent 会调用 `task_assign` 和 `task_get_progress_report`，并返回分配结果和汇报内容。

6. **（可选）指定任务库路径**

若想固定任务库位置，在插件配置里设 `dbPath`。OpenClaw 只识别 `plugins.entries.<id>.enabled` 与 `plugins.entries.<id>.config`，**不要**使用 `sourcePath`、`installPath` 等未支持的键：

```json
{
  "plugins": {
    "entries": {
      "never-forget-tasks": {
        "enabled": true,
        "config": { "dbPath": "/path/to/openclaw_tasks.db" }
      }
    }
  }
}
```

本地插件路径请用 CLI 安装（`openclaw plugins install --link <path>`），或通过 `plugins.load.paths` 添加目录数组。不配置则使用环境变量 `OPENCLAW_TASKS_DB` 或当前工作目录下的 `openclaw_tasks.db`。

**没有 OpenClaw 时**：可先跑 MCP Server（`npm run mcp`）并在 Cursor/Claude 里配置 MCP 调用同一套工具；或直接跑示例脚本验证逻辑：`npx tsx examples/ceo-workflow.ts`。

### 暴露的 MCP / 插件 Tools

| 工具名 | 说明 |
|--------|------|
| `task_assign` | 分配一条任务给某 agent |
| `task_update_status` | 更新任务状态（仅 assignee 可更新：传 `requested_by` 与 assignee 一致；设为 blocked/failed 时必填 `status_note`） |
| `task_list_by_assignee` | 按负责人列出任务 |
| `task_get_progress_report` | 获取进度汇报摘要（供 CEO 定时查看） |
| `task_list_overdue` | 列出逾期未完成的任务 |
| `task_list_blocked` | 列出被前序阻塞的任务 |
| `task_get` | 按 ID 查询单条任务详情 |

## 作为库使用（Node/TS）

若在自有 Node/TS 代码里直接使用存储与汇报逻辑（不通过 MCP）：

```ts
import { TaskStore } from "./src/store.js";
import { progressReport, formatReportForAgent } from "./src/report.js";

const store = new TaskStore("tasks.db");

// 分配
const t = store.assign({
  assignee: "agent_research",
  title: "完成市场调研报告",
  description: "Q1 竞品与用户需求",
  assigned_by: "ceo_agent",
});

// 更新状态
store.updateStatus(t.id, "completed");

// 进度汇报
const report = progressReport(store, {});
const text = formatReportForAgent(store, { language: "zh" });
console.log(text);
```

## 示例

```bash
npx tsx examples/ceo-workflow.ts
```

演示：CEO 分配三条有依赖的任务 → 模拟 research/design 完成 → 两次查看进度汇报（阻塞/可执行变化）。

## 如何测试

| 方式 | 命令/步骤 | 验证什么 |
|------|-----------|----------|
| **1. 跑示例脚本（最快）** | `npm run build && npm run example` | 库 + 存储 + 汇报逻辑：分配任务、更新状态、查进度、阻塞/可执行变化 |
| **2. MCP Server** | `npm run mcp`，在 Cursor/Claude 里配置 MCP 指向该进程，对话里让 AI 调用 `task_assign`、`task_get_progress_report` 等 | MCP 暴露的 7 个工具是否可用 |
| **3. OpenClaw 插件** | 按上文「如何试运行插件」安装并启用，在 OpenClaw 里让 Agent 分配任务、查进度 | 插件在 OpenClaw 内注册的 Agent Tools 是否可用 |

建议先跑 **1** 确认本地逻辑正常，再按需试 **2** 或 **3**。

**全自动多 Agent 协作**的扩展思路（可领任务、改派/重试、优先级、角色、产出传递等）见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 项目结构

```
openclaw-never-forget-tasks/
├── README.md
├── package.json
├── tsconfig.json
├── docs/
│   ├── ARCHITECTURE.md   # 形态说明：库 / MCP / OpenClaw Plugin
│   ├── ROADMAP.md       # 全自动多 Agent 协作：功能补充建议
│   └── SEQUENCE.md      # 主要流程序列图
├── src/
│   ├── models.ts         # Task 类型与序列化
│   ├── store.ts          # TaskStore（SQLite）
│   ├── report.ts         # progressReport, formatReportForAgent
│   └── mcp-server.ts     # MCP Server（stdio）
├── plugin-openclaw/      # OpenClaw 插件（进程内 Agent Tools）
│   ├── openclaw.plugin.json
│   ├── package.json
│   ├── index.ts          # 注册 task_* 等工具
│   └── tsconfig.json
└── examples/
    └── ceo-workflow.ts   # CEO 派活 + 定时检查示例
```

## 数据模型简述

| 字段 | 说明 |
|------|------|
| `id` | 任务唯一 ID |
| `assignee` | 负责的 Agent |
| `title` / `description` | 标题与描述 |
| `status` | pending / in_progress / completed / blocked / failed / cancelled |
| `status_note` | 状态为 blocked 或 failed 时填写的原因，供 CEO 处理后续 |
| `predecessor_ids` | 前序任务 ID 列表 |
| `successor_ids` | 后续任务 ID 列表 |
| `due_at` | 截止时间（ISO 字符串） |
| `assigned_by` | 派发者（如 CEO） |

持久化使用 SQLite 单文件，便于多进程/多 Agent 共用同一库。任务有可选字段 `status_note`：当状态为 `blocked` 或 `failed` 时填写原因，进度汇报中会展示给 CEO 便于后续处理。

## License

MIT

## Troubleshooting

**插件加载后报 `SqliteError: unable to open database file`**

默认 db 路径是 `~/.openclaw/openclaw_tasks.db`。如果 `~/.openclaw/` 目录不存在，SQLite 无法创建文件。确保目录存在：

```bash
mkdir -p ~/.openclaw
```

或在插件配置里指定一个已存在目录下的路径：

```json
{
  "plugins": {
    "entries": {
      "never-forget-tasks": {
        "config": { "dbPath": "/your/path/openclaw_tasks.db" }
      }
    }
  }
}
```

**`tools.allow` 报 unknown entries (never-forget-tasks)**

说明插件没加载成功。检查：
1. `openclaw plugins list` 里是否有 `never-forget-tasks`
2. `openclaw plugins doctor` 是否有报错
3. Gateway 日志（`/tmp/openclaw/openclaw-*.log`）里搜 `never-forget` 看具体错误

**MCP Server 和插件共用同一个 db**

设置环境变量 `OPENCLAW_TASKS_DB` 或在两边都配置相同的 dbPath，即可共用数据。
