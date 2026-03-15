# Architecture: Library / MCP / OpenClaw Plugin

"Never Forget Tasks" can be deployed in multiple forms depending on where your CEO Agent and orchestrator run. Current implementation: **TypeScript/Node library + MCP Server + OpenClaw Plugin**; OpenClaw can connect via MCP or install the plugin directly.

**Sequence diagrams** are in [SEQUENCE.md](./SEQUENCE.md), covering MCP, OpenClaw plugin, and direct library call paths.

### Who updates task status?

- **Assigning tasks**: The **CEO Agent** calls `task_assign` to dispatch tasks to worker agents (assignees).
- **Updating status**: Only the **assigned worker agent** can update their task. `task_update_status` requires `requested_by` (current agent's ID) to match the task's `assignee`, otherwise returns a permission error.
- **Failed/blocked requires explanation**: When a worker sets status to `blocked` or `failed`, they must provide a `status_note` explaining the reason. This is displayed in progress reports for CEO follow-up (reassign, cancel, retry, etc.).
- Valid statuses: `pending` / `in_progress` / `completed` / `blocked` / `failed` / `cancelled`.

---

## Three Forms Compared

| Form | What | Use Case |
|------|------|----------|
| **TypeScript Library** | Core: `TaskStore`, `progressReport`, `formatReportForAgent`, etc., imported directly by Node/TS code | Orchestrator/CEO logic written in **Node/TypeScript** (scripts, services, custom agent frameworks) |
| **MCP Server** | Exposes "assign tasks, check progress, update status" as **MCP Tools** for any MCP client | **OpenClaw, Cursor, Claude Desktop** and other MCP-capable environments |
| **OpenClaw Plugin** | Registers Agent Tools (TypeScript plugin) within OpenClaw, making task tools directly visible to agents | **Deep integration** with OpenClaw (dedicated config, UI, no separate MCP process needed) |

---

## Recommended: Library + MCP

- **Core**: Keep as a **TypeScript library** (single source of truth: models, storage, reporting logic).
- **External interface**: Provide an **MCP Server** (`src/mcp-server.ts`, built to `dist/mcp-server.js`), exposing assign/query/update/report as MCP Tools.
- **In OpenClaw**: OpenClaw supports MCP Server configuration. Add this project's MCP to `openclaw.json` and the CEO Agent can call these tools directly — **no need for a separate OpenClaw Plugin**.
- **In Cursor/Claude**: Point MCP config at the same server to assign tasks, check who's behind, and view progress in conversations.

Benefits:
- Single source of business logic (TypeScript library)
- Multi-client reuse (OpenClaw, Cursor, Claude, etc.)
- No need to maintain a separate OpenClaw plugin (unless you need plugin-specific UI or config)

---

## When to Consider the OpenClaw Plugin

Consider building/using the **OpenClaw Plugin** when:

- You need **task-specific configuration** in OpenClaw's config/control UI (e.g., default DB path, report frequency).
- You want tasks deeply integrated as **channels/commands** (e.g., `/tasks` command, dedicated channel).
- You don't want to configure MCP — just "install a plugin and get task tools".

The plugin can be implemented in two ways:

1. **Wrap MCP client**: Plugin calls this project's MCP Server via OpenClaw's MCP client (logic stays in TypeScript).
2. **HTTP calls**: Run a small HTTP API based on this library, plugin calls the API; or use child_process to call Node scripts (not recommended, high complexity).

Generally, **start with MCP, add plugin as needed**. This repo already provides an **OpenClaw Plugin** ready to install.

### Installing and Using the OpenClaw Plugin

1. Build the core library and install plugin dependencies:

```bash
cd openclaw-never-forget-tasks
npm install
npm run build
cd plugin-openclaw
npm install
```

2. Install the plugin in OpenClaw (link mode, no file copy):

```bash
openclaw plugins install --link /path/to/openclaw-never-forget-tasks/plugin-openclaw
```

3. Enable the plugin and (optionally) specify the database path in config:

```bash
openclaw plugins enable never-forget-tasks
```

You can set `dbPath` in OpenClaw's plugin config (to share the same SQLite with MCP). If not configured, uses `OPENCLAW_TASKS_DB` env var or defaults to `~/.openclaw/openclaw_tasks.db`.

4. Allow this plugin's tools in the agent's `tools.allow` (e.g., `never-forget-tasks` or specific tool names like `task_assign`, `task_get_progress_report`, etc.).

---

## Summary

| Need | Recommended Form |
|------|-----------------|
| CEO Agent assigns/checks tasks in OpenClaw | **MCP Server** (configure OpenClaw's MCP to point here) |
| Use the same task tools in Cursor/Claude | **MCP Server** (same implementation, multi-client reuse) |
| Use in your own Node/TS scripts or services | **Use the TypeScript library directly** (`TaskStore` + `progressReport`) |
| Deep integration with OpenClaw config/UI | **OpenClaw Plugin** (provided), uses the core library internally |

This repo provides: **Library** + **MCP Server** + **OpenClaw Plugin**. OpenClaw users can choose: configure MCP or install the plugin.

### Running the MCP Server

Requires **Node.js ≥20**. Install dependencies and run via stdio (for OpenClaw / Cursor connection):

```bash
npm install
npm run build
export OPENCLAW_TASKS_DB=/path/to/tasks.db   # optional, defaults to ~/.openclaw/openclaw_tasks.db
node dist/mcp-server.js
```

Add this server's command/args to OpenClaw's MCP config (e.g., `command: "node"`, `args: ["/path/to/openclaw-never-forget-tasks/dist/mcp-server.js"]`) to make `task_assign`, `task_get_progress_report`, `task_list_overdue`, `task_list_blocked`, etc. available to agents.
