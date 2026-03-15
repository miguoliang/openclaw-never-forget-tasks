# Sequence Diagrams

This document illustrates how "Never Forget Tasks" works in **MCP**, **OpenClaw Plugin**, and **direct library call** paths.

---

## 1. MCP Path: Agent calls task tools via MCP

OpenClaw / Cursor / Claude acts as an MCP client, communicating with the MCP Server via stdio. The agent sees MCP Tools like `task_assign` and `task_get_progress_report`.

```mermaid
sequenceDiagram
    participant Agent
    participant Client as MCP Client<br/>(OpenClaw/Cursor)
    participant Transport as stdio Transport
    participant MCP as MCP Server
    participant Store as TaskStore
    participant DB as SQLite

    Note over Agent,DB: Startup
    MCP->>Store: new TaskStore(dbPath)
    Store->>DB: Create tables / connect

    Note over Agent,DB: Runtime: Agent assigns task
    Agent->>Client: Decides to call task_assign(assignee, title, ...)
    Client->>Transport: Tool Call (JSON-RPC)
    Transport->>MCP: Receives Tool Call
    MCP->>Store: store.assign({...})
    Store->>DB: INSERT INTO tasks ...
    Store-->>MCP: Task object
    MCP-->>Transport: Tool Result (content: text)
    Transport-->>Client: JSON-RPC response
    Client-->>Agent: "Task [id] assigned to xxx: title"

    Note over Agent,DB: Runtime: Agent checks progress
    Agent->>Client: Calls task_get_progress_report(language)
    Client->>Transport: Tool Call
    Transport->>MCP: Receives
    MCP->>Store: formatReportForAgent(store, {language})
    Store->>DB: SELECT ... (overdue, blocked, by assignee)
    Store-->>MCP: Report text
    MCP-->>Transport: Tool Result (content: report text)
    Transport-->>Client: JSON-RPC response
    Client-->>Agent: [Task Progress Report]...
```

---

## 2. OpenClaw Plugin Path: In-Process Agent Tools

The plugin loads within the OpenClaw Gateway process, registering Agent Tools. When the agent calls a tool, Gateway directly invokes the plugin's `execute` — no separate MCP process needed.

```mermaid
sequenceDiagram
    participant Agent
    participant Gateway as OpenClaw Gateway
    participant Plugin as never-forget-tasks Plugin
    participant Store as TaskStore
    participant DB as SQLite

    Note over Agent,DB: Startup: Load plugin
    Gateway->>Plugin: Load plugin-openclaw (jiti)
    Plugin->>Plugin: getConfig() / env var → dbPath
    Plugin->>Store: new TaskStore(dbPath)
    Store->>DB: Create tables / connect
    loop For each task_* tool
        Plugin->>Gateway: api.registerTool(...)
    end
    Gateway-->>Gateway: Add tools to agent's available list

    Note over Agent,DB: Runtime: Agent assigns task
    Agent->>Gateway: Call tool: task_assign(assignee, title, ...)
    Gateway->>Plugin: execute(params)
    Plugin->>Store: store.assign({...})
    Store->>DB: INSERT INTO tasks ...
    Store-->>Plugin: Task object
    Plugin-->>Gateway: { content: [{ type: "text", text: "Task assigned..." }] }
    Gateway-->>Agent: Tool return text

    Note over Agent,DB: Runtime: Agent checks progress
    Agent->>Gateway: Call tool: task_get_progress_report(language)
    Gateway->>Plugin: execute(params)
    Plugin->>Store: formatReportForAgent(store, {language})
    Store->>DB: SELECT ... (overdue, blocked, by assignee)
    Store-->>Plugin: Report text
    Plugin-->>Gateway: { content: [{ type: "text", text: "[Task Progress Report]..." }] }
    Gateway-->>Agent: Report content
```

---

## 3. Direct Library Call: Using TaskStore in Scripts/Services

Import the core library directly in your own Node/TS scripts or services, without going through MCP or plugin.

```mermaid
sequenceDiagram
    participant Script as Script/Service<br/>(ceo-workflow.ts etc.)
    participant Store as TaskStore
    participant Report as report.ts
    participant DB as SQLite

    Script->>Store: new TaskStore(dbPath)
    Store->>DB: Create tables / connect

    Script->>Store: store.assign({assignee, title, ...})
    Store->>DB: INSERT INTO tasks ...
    Store-->>Script: Task object

    Script->>Store: store.updateStatus(id, "completed")
    Store->>DB: UPDATE tasks SET status = ...
    Store-->>Script: Updated Task

    Script->>Report: formatReportForAgent(store, {language})
    Report->>Store: (same queries)
    Store->>DB: SELECT ...
    Store-->>Report: Task lists
    Report-->>Script: string (readable report text)
```

---

## 4. Relationship Between Three Forms and Core Library (Overview)

```mermaid
graph TB
    subgraph Callers
        A[OpenClaw / Cursor / Claude]
        B[Scripts / Services]
    end

    subgraph Interface Layer
        M[MCP Server - stdio]
        P[OpenClaw Plugin - in-process]
    end

    subgraph Core Library
        S[TaskStore]
        R[report.ts]
        Mo[models.ts]
    end

    DB[(SQLite)]

    A -->|MCP protocol stdio| M
    A -->|Agent Tool calls| P
    B -->|Direct import| S

    M --> S
    M --> R
    P --> S
    P --> R
    S --> Mo
    R --> S
    S --> DB
```

**Key points**:

- **Library**: Core — models, store, report. Single source of truth.
- **MCP**: Standalone process, communicates via stdio with clients, uses TaskStore + report internally.
- **Plugin**: In-process Agent Tools registration, also uses TaskStore + report internally, can share the same `dbPath` with MCP.
- **Library**: Direct use of TaskStore and report, same data and logic.
