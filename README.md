# openclaw-never-forget-tasks

**Multi-agent task tracking and progress reporting** — TypeScript + Node, providing both **MCP Server** and **OpenClaw Plugin**, designed for a CEO Agent managing multiple specialized agents.

## Features

- **Track "who needs to do what"**: CEO assigns tasks with assignee, title, description, due date, etc.
- **Task dependencies**: `predecessor_ids` / `successor_ids` for expressing dependencies and pipelines
- **Periodic checks**: CEO can pull "incomplete", "overdue", "blocked", "ready to execute" views
- **Progress reports**: `progressReport()` and `formatReportForAgent()` generate readable summaries for reporting and decision-making

## Tech Stack

- **TypeScript** + **Node.js** (≥20)
- **SQLite** (better-sqlite3)
- **MCP** (@modelcontextprotocol/sdk): exposes Tools via stdio for OpenClaw, Cursor, Claude, etc.

## Installation

```bash
git clone https://github.com/miguoliang/openclaw-never-forget-tasks.git
cd openclaw-never-forget-tasks
npm install
```

### Running as MCP Server (stdio)

```bash
# Development
npm run mcp
# Or build first
npm run build && node dist/mcp-server.js
```

Set the `OPENCLAW_TASKS_DB` environment variable to specify the SQLite file path (defaults to `~/.openclaw/openclaw_tasks.db`).

Add this server to **OpenClaw**'s MCP configuration:

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

For **Cursor** and other MCP clients, point to the same `command` + `args`.

### As OpenClaw Plugin (recommended for OpenClaw users)

No need to run a separate MCP process — install the plugin directly within OpenClaw:

```bash
# From the repo root
npm install && npm run build
cd plugin-openclaw && npm install

# Install and enable the plugin (--link for local development)
openclaw plugins install --link /path/to/openclaw-never-forget-tasks/plugin-openclaw
openclaw plugins enable never-forget-tasks
```

Add `never-forget-tasks` or specific tool names to your agent's `tools.allow`. Optionally set `dbPath` in the OpenClaw plugin config to share the same SQLite DB with MCP; if not set, uses `OPENCLAW_TASKS_DB` env var or defaults to `~/.openclaw/openclaw_tasks.db`.

#### Quick Start Guide

**Prerequisites**: [OpenClaw](https://docs.openclaw.ai) installed and `openclaw` command available; Node.js ≥ 20.

1. **Build and install plugin dependencies**

```bash
cd /path/to/openclaw-never-forget-tasks
npm install && npm run build
cd plugin-openclaw && npm install
```

2. **Install plugin via link (no copy, code changes take effect immediately)**

```bash
openclaw plugins install --link /path/to/openclaw-never-forget-tasks/plugin-openclaw
openclaw plugins enable never-forget-tasks
```

3. **Verify plugin is loaded**

```bash
openclaw plugins list
openclaw plugins doctor
```

You should see `never-forget-tasks` in the list with no errors.

4. **Allow task tools for your agent**

In your OpenClaw config (e.g., `openclaw.json`), add the tool allowlist for the agent that needs task capabilities:

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

Or allow specific tools: `["task_assign", "task_get_progress_report", "task_list_by_assignee", "task_update_status", "task_get", "task_list_overdue", "task_list_blocked"]`.

5. **Start OpenClaw and test**

Start OpenClaw and ask the agent:
"Assign a task to agent_research with the title 'Test task'."
Then: "Show me the current task progress report."
If configured correctly, the agent will call `task_assign` and `task_get_progress_report`.

6. **(Optional) Specify database path**

To fix the database location, set `dbPath` in the plugin config. OpenClaw only recognizes `plugins.entries.<id>.enabled` and `plugins.entries.<id>.config` — **do not** use unsupported keys like `sourcePath` or `installPath`:

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

For local plugin paths, use CLI installation (`openclaw plugins install --link <path>`) or add directories via `plugins.load.paths`. Without configuration, defaults to `OPENCLAW_TASKS_DB` env var or `~/.openclaw/openclaw_tasks.db`.

**Without OpenClaw**: Run the MCP Server (`npm run mcp`) and configure MCP in Cursor/Claude; or run the example script: `npx tsx examples/ceo-workflow.ts`.

### Exposed MCP / Plugin Tools

| Tool | Description |
|------|-------------|
| `task_assign` | Assign a task to an agent |
| `task_update_status` | Update task status (only assignee can update via `requested_by`; `status_note` required for blocked/failed) |
| `task_list_by_assignee` | List tasks by assignee |
| `task_get_progress_report` | Get progress report summary (for CEO periodic review) |
| `task_list_overdue` | List overdue incomplete tasks |
| `task_list_blocked` | List tasks blocked by predecessors |
| `task_get` | Get task details by ID |

## As a Library (Node/TS)

Use the store and report logic directly in your own Node/TS code (without MCP):

```ts
import { TaskStore } from "./src/store.js";
import { progressReport, formatReportForAgent } from "./src/report.js";

const store = new TaskStore("tasks.db");

// Assign
const t = store.assign({
  assignee: "agent_research",
  title: "Complete market research report",
  description: "Q1 competitive analysis and user needs",
  assigned_by: "ceo_agent",
});

// Update status
store.updateStatus(t.id, "completed");

// Progress report
const report = progressReport(store, {});
const text = formatReportForAgent(store, { language: "en" });
console.log(text);
```

## Example

```bash
npx tsx examples/ceo-workflow.ts
```

Demo: CEO assigns three dependent tasks → simulates research/design completion → views progress report twice (blocked/unblocked changes).

## Testing

```bash
npm test
```

| Method | Command/Steps | What it verifies |
|--------|---------------|------------------|
| **1. Example script (fastest)** | `npm run build && npm run example` | Store + report logic: assign, update, progress, blocked/unblocked |
| **2. MCP Server** | `npm run mcp`, configure MCP in Cursor/Claude, ask AI to call `task_assign`, `task_get_progress_report`, etc. | MCP-exposed tools |
| **3. OpenClaw Plugin** | Follow the Quick Start Guide above | Plugin-registered Agent Tools |
| **4. Unit tests** | `npm test` | 30 tests covering models, store, report |

For full-auto multi-agent collaboration roadmap (claimable tasks, reassignment/retry, priority, roles, output passing), see [docs/ROADMAP.md](docs/ROADMAP.md).

## Project Structure

```
openclaw-never-forget-tasks/
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docs/
│   ├── ARCHITECTURE.md   # Architecture: Library / MCP / OpenClaw Plugin
│   ├── ROADMAP.md         # Full-auto multi-agent collaboration roadmap
│   └── SEQUENCE.md        # Sequence diagrams
├── src/
│   ├── models.ts          # Task types and serialization
│   ├── store.ts           # TaskStore (SQLite)
│   ├── report.ts          # progressReport, formatReportForAgent
│   ├── mcp-server.ts      # MCP Server (stdio)
│   └── __tests__/         # Unit tests
├── plugin-openclaw/       # OpenClaw plugin (in-process Agent Tools)
│   ├── openclaw.plugin.json
│   ├── package.json
│   ├── index.ts           # Registers task_* tools
│   └── tsconfig.json
└── examples/
    └── ceo-workflow.ts    # CEO workflow example
```

## Data Model

| Field | Description |
|-------|-------------|
| `id` | Unique task ID |
| `assignee` | Responsible agent |
| `title` / `description` | Title and description |
| `status` | pending / in_progress / completed / blocked / failed / cancelled |
| `status_note` | Reason for blocked/failed status, for CEO follow-up |
| `predecessor_ids` | Predecessor task IDs |
| `successor_ids` | Successor task IDs |
| `due_at` | Due date (ISO string) |
| `assigned_by` | Assigner (e.g., CEO) |

Persistence uses a single SQLite file, suitable for multi-process/multi-agent sharing. The optional `status_note` field is required when setting status to `blocked` or `failed`, and is displayed in progress reports for CEO follow-up.

## Troubleshooting

**`SqliteError: unable to open database file` after plugin loads**

Default db path is `~/.openclaw/openclaw_tasks.db`. If `~/.openclaw/` doesn't exist, SQLite can't create the file. Ensure the directory exists:

```bash
mkdir -p ~/.openclaw
```

Or specify a path in an existing directory via plugin config:

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

**`tools.allow` reports unknown entries (never-forget-tasks)**

The plugin didn't load successfully. Check:
1. `openclaw plugins list` shows `never-forget-tasks`
2. `openclaw plugins doctor` has no errors
3. Gateway logs (`/tmp/openclaw/openclaw-*.log`) — search for `never-forget` for specific errors

**Sharing db between MCP Server and Plugin**

Set the `OPENCLAW_TASKS_DB` environment variable or configure the same `dbPath` in both to share data.

## License

MIT
