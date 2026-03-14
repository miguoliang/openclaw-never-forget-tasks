# 主要流程序列图

本文档用序列图说明「不能忘任务」在 **MCP**、**OpenClaw 插件**、**库直接调用** 三种形态下的工作方式。

---

## 1. MCP 路径：Agent 通过 MCP 调用任务工具

OpenClaw / Cursor / Claude 等作为 MCP 客户端，通过 stdio 与 MCP Server 通信；Agent 看到的是一组 MCP Tools（如 `task_assign`、`task_get_progress_report`）。

```mermaid
sequenceDiagram
    participant Agent as CEO Agent
    participant Client as MCP 客户端<br/>(OpenClaw/Cursor)
    participant Transport as stdio
    participant MCP as MCP Server<br/>(mcp-server.js)
    participant Store as TaskStore
    participant DB as SQLite

    Note over Agent,DB: 启动时
    Client->>Transport: 启动子进程 (node dist/mcp-server.js)
    MCP->>Store: new TaskStore(dbPath)
    Store->>DB: 建表 / 连接

    Note over Agent,DB: 运行时：Agent 分配任务
    Agent->>Client: 决定调用 task_assign(assignee, title, ...)
    Client->>Transport: MCP Tool Call (task_assign, params)
    Transport->>MCP: 收到 Tool Call
    MCP->>Store: store.assign({ assignee, title, ... })
    Store->>DB: INSERT INTO tasks ...
    DB-->>Store: ok
    Store-->>MCP: Task
    MCP-->>Transport: Tool Result (content: text)
    Transport-->>Client: Result
    Client-->>Agent: "已分配任务 [id] 给 xxx: 标题"

    Note over Agent,DB: 运行时：Agent 查进度
    Agent->>Client: 调用 task_get_progress_report(language)
    Client->>Transport: MCP Tool Call (task_get_progress_report)
    Transport->>MCP: 收到
    MCP->>Store: formatReportForAgent(store, { language })
    Store->>DB: SELECT ... (listOverdue, getBlockedTasks, ...)
    DB-->>Store: rows
    Store-->>MCP: 汇总文本
    MCP-->>Transport: Tool Result (content: 汇报文本)
    Transport-->>Client: Result
    Client-->>Agent: 【任务进度汇报】...
```

---

## 2. OpenClaw 插件路径：进程内 Agent Tools

插件在 OpenClaw Gateway 进程内加载，注册一组 Agent Tools；Agent 调用时由 Gateway 直接调用插件的 `execute`，无需单独 MCP 进程。

```mermaid
sequenceDiagram
    participant Agent as CEO Agent
    participant Gateway as OpenClaw Gateway
    participant Plugin as never-forget-tasks 插件
    participant Store as TaskStore
    participant DB as SQLite

    Note over Agent,DB: 启动时：加载插件
    Gateway->>Plugin: 加载 plugin-openclaw (jiti)
    Plugin->>Plugin: getConfig() / 环境变量 → dbPath
    Plugin->>Store: new TaskStore(dbPath)
    Store->>DB: 建表 / 连接
    loop 每个 task_* 工具
        Plugin->>Gateway: api.registerTool({ name, description, parameters, execute })
    end
    Gateway-->>Gateway: 将工具加入 Agent 可用列表

    Note over Agent,DB: 运行时：Agent 分配任务
    Agent->>Gateway: 调用 tool: task_assign(assignee, title, ...)
    Gateway->>Plugin: execute(tool_call_id, params)
    Plugin->>Store: store.assign(params)
    Store->>DB: INSERT INTO tasks ...
    DB-->>Store: ok
    Store-->>Plugin: Task
    Plugin-->>Gateway: { content: [{ type: "text", text: "已分配..." }] }
    Gateway-->>Agent: 工具返回文本

    Note over Agent,DB: 运行时：Agent 查进度
    Agent->>Gateway: 调用 tool: task_get_progress_report(language)
    Gateway->>Plugin: execute(tool_call_id, params)
    Plugin->>Store: formatReportForAgent(store, { language })
    Store->>DB: SELECT ... (逾期、阻塞、按负责人)
    DB-->>Store: rows
    Store-->>Plugin: 汇报文本
    Plugin-->>Gateway: { content: [{ type: "text", text: "【任务进度汇报】..." }] }
    Gateway-->>Agent: 汇报内容
```

---

## 3. 库直接调用：脚本/服务内使用 TaskStore

在自有 Node/TS 脚本或服务中直接 `import` 核心库，不经过 MCP 或插件。

```mermaid
sequenceDiagram
    participant Script as 脚本/服务<br/>(ceo-workflow.ts 等)
    participant Store as TaskStore
    participant Report as report (progressReport, formatReportForAgent)
    participant DB as SQLite

    Script->>Store: new TaskStore(dbPath)
    Store->>DB: 建表 / 连接

    Script->>Store: store.assign({ assignee, title, ... })
    Store->>DB: INSERT INTO tasks
    DB-->>Store: ok
    Store-->>Script: Task

    Script->>Store: store.updateStatus(taskId, "completed")
    Store->>DB: UPDATE tasks SET status=...
    DB-->>Store: ok
    Store-->>Script: Task

    Script->>Report: progressReport(store, options)
    Report->>Store: listPendingOrInProgress(), listOverdue(), getBlockedTasks(), ...
    Store->>DB: SELECT ...
    DB-->>Store: rows
    Store-->>Report: Task[]
    Report-->>Script: ProgressReport

    Script->>Report: formatReportForAgent(store, { language })
    Report->>Store: (同上查询)
    Store->>DB: SELECT ...
    DB-->>Store: rows
    Store-->>Report: Task[]
    Report-->>Script: string (可读汇报文本)
```

---

## 4. 三种形态与核心库的关系（概览）

```mermaid
flowchart LR
    subgraph 调用方
        A[CEO Agent]
        B[脚本/服务]
    end

    subgraph 对接层
        M[MCP Server]
        P[OpenClaw Plugin]
    end

    subgraph 核心库
        S[TaskStore]
        R[formatReportForAgent / progressReport]
    end

    DB[(SQLite)]

    A -->|MCP 协议 stdio| M
    A -->|Agent Tool 调用| P
    B -->|import| S
    B -->|import| R

    M --> S
    M --> R
    P --> S
    P --> R
    S --> DB
    R --> S
```

- **MCP**：独立进程，通过 stdio 与客户端通信，内部使用 TaskStore + report。
- **Plugin**：进程内注册 Agent Tools，内部同样使用 TaskStore + report，可与 MCP 共用同一 `dbPath`。
- **库**：直接使用 TaskStore 与 report，同一套数据与逻辑。
