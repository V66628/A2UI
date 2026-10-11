import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LLMAgent } from "../src/agent/llm-agent";
import { loadEvalScenarios } from "../src/eval/scenarios";
import {
  validateA2UIOutput,
  type ValidationStats,
} from "../src/eval/validate-protocol";

/**
 * A2UI Agent 端到端生成评测（真实多模态模型，集成测试）。
 *
 * 默认跳过（模型调用慢且非确定性）。运行方式（PowerShell）：
 *   $env:RUN_EVAL=1; pnpm eval:agent
 * 只跑部分场景：
 *   $env:RUN_EVAL=1; $env:EVAL_ONLY="eval-01,eval-06"; pnpm eval:agent
 *
 * 每个场景：真实 LLMAgent 消费 userPrompt → 收集 JSONL →
 * 确定性校验器比对 expect；任一违规即该场景失败。
 * 多轮场景：每轮请求携带当前已累积协议（currentProtocol），
 * agent 仅返回增量，客户端拼回后再进入下一轮。
 * 全部结果写入 eval/reports/last-run.json。
 */

const LIVE = process.env.RUN_EVAL === "1";

/** 多轮场景中单轮的结果 */
interface TurnReport {
  turn: number;
  prompt: string;
  passed: boolean;
  violations: string[];
  stats: Pick<ValidationStats, "messageCount" | "componentCount">;
}

interface ScenarioReport {
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  violations: string[];
  /** 多轮场景的逐轮结果（单轮场景缺省） */
  turnReports?: TurnReport[];
  stats: Pick<
    ValidationStats,
    | "messageCount"
    | "componentCount"
    | "typeCounts"
    | "actionNames"
    | "templateCount"
  > | null;
}

const reports: ScenarioReport[] = [];

function selectScenarios() {
  const all = loadEvalScenarios();
  const only = process.env.EVAL_ONLY?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return only ? all.filter((s) => only.includes(s.id)) : all;
}

describe(
  "A2UI Agent 生成评测（真实模型，集成；设 RUN_EVAL=1 运行）",
  {
    skip: LIVE
      ? false
      : "skipped: set $env:RUN_EVAL=1 and run `pnpm eval:agent`",
    timeout: 600000,
  },
  () => {
    const scenarios = selectScenarios();

    for (const scenario of scenarios) {
      it(`${scenario.id} · ${scenario.name}`, async () => {
        const startedAt = Date.now();
        const toolCalls: string[] = [];
        const agent = new LLMAgent({
          onToolCall: (toolName) => toolCalls.push(toolName),
        });
        // 多轮场景：首轮 userPrompt/expect + turns；同一线程/agent
        const turnSpecs = [
          { prompt: scenario.userPrompt, expect: scenario.expect },
          ...(scenario.turns ?? []),
        ];
        const turnReports: TurnReport[] = [];
        let lastResult: ReturnType<typeof validateA2UIOutput> | null = null;
        // 客户端侧累积协议：首轮后逐步拼入各轮返回的增量，
        // 下一轮作为 currentProtocol 回传（与 playground 行为一致）
        let accumulatedProtocol = "";

        for (let i = 0; i < turnSpecs.length; i += 1) {
          const spec = turnSpecs[i];
          const rawLines: string[] = [];

          for await (const line of agent.run({
            input: spec.prompt,
            currentProtocol: accumulatedProtocol || undefined,
            threadId: `eval-${scenario.id}`,
            runId: `eval-run-${scenario.id}-t${i + 1}`,
          })) {
            rawLines.push(line);
          }

          // 本轮返回内容拼回完整协议
          accumulatedProtocol = accumulatedProtocol
            ? `${accumulatedProtocol}\n${rawLines.join("\n")}`
            : rawLines.join("\n");

          const messages = rawLines.map((line) => JSON.parse(line) as unknown);
          const result = validateA2UIOutput(messages, spec.expect);

          // 工具调用期望（一般仅首轮声明）：这些工具必须被调用过
          const toolViolations: string[] = [];
          for (const toolName of spec.expect.requireToolCalls ?? []) {
            if (!toolCalls.includes(toolName)) {
              toolViolations.push(
                `expected tool call "${toolName}" did not happen`,
              );
            }
          }

          const turnViolations = [...result.violations, ...toolViolations];
          turnReports.push({
            turn: i + 1,
            prompt: spec.prompt,
            passed: turnViolations.length === 0,
            violations: turnViolations,
            stats: {
              messageCount: result.stats.messageCount,
              componentCount: result.stats.componentCount,
            },
          });
          lastResult = result;
        }

        const violations = turnReports.flatMap((t) =>
          t.violations.map((v) => `turn ${t.turn}: ${v}`),
        );
        const durationMs = Date.now() - startedAt;

        reports.push({
          id: scenario.id,
          name: scenario.name,
          passed: violations.length === 0,
          durationMs,
          violations,
          turnReports: scenario.turns ? turnReports : undefined,
          stats: lastResult
            ? {
                messageCount: lastResult.stats.messageCount,
                componentCount: lastResult.stats.componentCount,
                typeCounts: lastResult.stats.typeCounts,
                actionNames: lastResult.stats.actionNames,
                templateCount: lastResult.stats.templateCount,
              }
            : null,
        });

        assert.equal(
          violations.length,
          0,
          `${scenario.id} violations:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
        );
      });
    }

    after(() => {
      const passed = reports.filter((r) => r.passed).length;
      const summary = {
        date: new Date().toISOString(),
        total: reports.length,
        passed,
        failed: reports.length - passed,
        passRate: reports.length
          ? Number((passed / reports.length).toFixed(3))
          : 0,
        scenarios: reports,
      };

      const reportsDir = resolve(__dirname, "..", "eval", "reports");
      mkdirSync(reportsDir, { recursive: true });
      writeFileSync(
        resolve(reportsDir, "last-run.json"),
        JSON.stringify(summary, null, 2),
      );

      // 控制台汇总表（多轮场景逐轮标记）
      const lines = reports.flatMap((r) => {
        if (!r.turnReports) {
          return [
            `${r.passed ? "PASS" : "FAIL"}  ${r.id}  ${r.name}  (${r.durationMs}ms, ${r.stats?.componentCount ?? 0} components)`,
          ];
        }
        return [
          `${r.passed ? "PASS" : "FAIL"}  ${r.id}  ${r.name}  (${r.durationMs}ms, ${r.turnReports.length} turns)`,
          ...r.turnReports.map(
            (t) =>
              `        ${t.passed ? "✔" : "✖"} turn ${t.turn}  (${t.stats.messageCount} msgs, ${t.stats.componentCount} components)`,
          ),
        ];
      });
      lines.push(
        `\n${passed}/${reports.length} passed (${(summary.passRate * 100).toFixed(1)}%)`,
      );
      lines.push(`report: eval/reports/last-run.json`);
      // eslint-disable-next-line no-console
      console.log(`\n${lines.join("\n")}`);
    });
  },
);
