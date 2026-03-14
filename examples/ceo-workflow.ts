/**
 * 示例：CEO Agent 管理多 Agent 的任务流。
 * 运行: npx tsx examples/ceo-workflow.ts
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

console.log("=== 1. CEO 分配任务 ===\n");

const tResearch = store.assign({
  assignee: "agent_research",
  title: "完成 Q1 市场调研报告",
  description: "竞品分析 + 用户访谈结论",
  due_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  assigned_by: "ceo_agent",
});
console.log(`  已分配: [${tResearch.id}] agent_research -> ${tResearch.title}`);

const tDesign = store.assign({
  assignee: "agent_design",
  title: "根据调研结论做产品原型",
  description: "高保真原型，标注优先级",
  predecessor_ids: [tResearch.id],
  due_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  assigned_by: "ceo_agent",
});
console.log(`  已分配: [${tDesign.id}] agent_design -> ${tDesign.title} (依赖调研)`);

const tEngineer = store.assign({
  assignee: "agent_engineer",
  title: "实现原型中的 P0 功能",
  description: "后端 API + 前端页面",
  predecessor_ids: [tDesign.id],
  due_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  assigned_by: "ceo_agent",
});
console.log(`  已分配: [${tEngineer.id}] agent_engineer -> ${tEngineer.title} (依赖设计)`);

console.log("\n=== 2. 执行进展：research 完成，design 进行中 ===\n");

store.updateStatus(tResearch.id, "completed");
console.log("  agent_research: 任务已完成");
store.updateStatus(tDesign.id, "in_progress");
console.log("  agent_design: 进行中");

console.log("\n=== 3. CEO 定时查看进度汇报 ===\n");

const report = progressReport(store, {});
console.log("  汇总:", report.summary);
console.log("  有未完成任务的负责人:", report.assignees_with_open_tasks);
console.log("  被阻塞任务数:", report.summary.blocked_count, "(engineer 等 design)");

const text = formatReportForAgent(store, { language: "zh" });
console.log("\n--- 给 CEO Agent 的汇报文本 ---\n");
console.log(text);

console.log("\n=== 4. design 完成后，再查一次 ===\n");

store.updateStatus(tDesign.id, "completed");
console.log("  agent_design: 任务已完成\n");

const text2 = formatReportForAgent(store, { language: "zh" });
console.log(text2);
console.log("\n此时 agent_engineer 的任务不再被阻塞，可执行。");
