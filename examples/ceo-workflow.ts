/**
 * Example: CEO Agent managing a multi-agent task workflow.
 * Run: npx tsx examples/ceo-workflow.ts
 */

import { TaskStore } from "../src/store.js";
import { progressReport, formatReportForAgent } from "../src/report.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { unlinkSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "ceo_tasks_demo.db");
if (existsSync(dbPath)) {
  unlinkSync(dbPath);
}

const store = new TaskStore(dbPath);

console.log("=== 1. CEO assigns tasks ===\n");

const tResearch = store.assign({
  assignee: "agent_research",
  title: "Complete Q1 market research report",
  description: "Competitive analysis + user interview conclusions",
  due_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  assigned_by: "ceo_agent",
});
console.log(`  Assigned: [${tResearch.id}] agent_research -> ${tResearch.title}`);

const tDesign = store.assign({
  assignee: "agent_design",
  title: "Create product prototype based on research",
  description: "High-fidelity prototype with priority labels",
  predecessor_ids: [tResearch.id],
  due_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  assigned_by: "ceo_agent",
});
console.log(`  Assigned: [${tDesign.id}] agent_design -> ${tDesign.title} (depends on research)`);

const tEngineer = store.assign({
  assignee: "agent_engineer",
  title: "Implement P0 features from prototype",
  description: "Backend API + frontend pages",
  predecessor_ids: [tDesign.id],
  due_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  assigned_by: "ceo_agent",
});
console.log(`  Assigned: [${tEngineer.id}] agent_engineer -> ${tEngineer.title} (depends on design)`);

console.log("\n=== 2. Progress: research completed, design in progress ===\n");

store.updateStatus(tResearch.id, "completed");
console.log("  agent_research: task completed");
store.updateStatus(tDesign.id, "in_progress");
console.log("  agent_design: in progress");

console.log("\n=== 3. CEO reviews progress report ===\n");

const report = progressReport(store, {});
console.log("  Summary:", report.summary);
console.log("  Assignees with open tasks:", report.assignees_with_open_tasks);
console.log("  Blocked task count:", report.summary.blocked_count, "(engineer waiting on design)");

const text = formatReportForAgent(store, { language: "en" });
console.log("\n--- Report for CEO Agent ---\n");
console.log(text);

console.log("\n=== 4. After design completes, check again ===\n");

store.updateStatus(tDesign.id, "completed");
console.log("  agent_design: task completed\n");

const text2 = formatReportForAgent(store, { language: "en" });
console.log(text2);
console.log("\nNow agent_engineer's task is no longer blocked and can proceed.");
