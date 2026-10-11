import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 评测场景的结构化期望（确定性 oracle，由校验器逐条比对）。
 * 所有字段可选；缺省即不约束。
 */
export interface ScenarioExpect {
  /** 输出中必须出现的组件类型（均为 supportedComponents 子集） */
  requiredComponents?: string[];
  /** 输出中禁止出现的组件类型 */
  forbiddenComponents?: string[];
  /** 唯一组件数量下限 */
  minComponents?: number;
  /** 至少一条 dataModelUpdate */
  requireDataModel?: boolean;
  /** 至少一处 children.template 动态列表 */
  requireTemplateList?: boolean;
  /** Button action 必须包含的名称 */
  requiredActions?: string[];
  /** dataModelUpdate 必须覆盖到的数据路径 */
  requiredDataPaths?: string[];
  /** 组件中必须引用到的绑定路径 */
  requiredBindings?: string[];
  /** literalString 拼接文本中必须包含的字符串（忽略大小写） */
  requiredLiterals?: string[];
  /** Icon 组件必须用到的 canonical 图标名 */
  requiredIcons?: string[];
  /** 生成过程中必须被模型调用过的工具名（如 search_antd_icons） */
  requireToolCalls?: string[];
  /**
   * 该轮为多轮微调的增量补丁：
   * 允许不含 surfaceUpdate，beginRendering.root 与 explicitList 引用的
   * 未重定义 id 视为已存在于客户端，不做悬空检查。
   */
  partialUpdate?: boolean;
}

/** 多轮评测中的单轮：一条跟进指令与该轮补丁的期望 */
export interface EvalTurn {
  /** 本轮用户指令（首轮之外的微调请求） */
  prompt: string;
  /** 本轮输出的期望（微调轮通常 partialUpdate: true） */
  expect: ScenarioExpect;
}

/** 单条评测场景 */
export interface EvalScenario {
  id: string;
  name: string;
  category: string;
  tags: string[];
  userPrompt: string;
  expect: ScenarioExpect;
  /**
   * 多轮微调场景：给出时，runner 在同一线程/agent 上依次执行
   * 首轮 userPrompt/expect 与 turns 中的每一轮。
   */
  turns?: EvalTurn[];
}

/** 评测集文件结构 */
interface EvalScenarioFile {
  schemaVersion: string;
  description: string;
  supportedComponents: string[];
  scenarios: EvalScenario[];
}

/** eval 目录下评测集 JSON 的文件名 */
const SCENARIO_FILE_NAME = "a2ui_generation_eval_scenarios.json";

let cachedFile: EvalScenarioFile | null = null;

/** 定位评测集 JSON（src/eval → ../../eval） */
function resolveScenarioPath(): string {
  const candidates = [
    resolve(__dirname, "..", "..", "eval", SCENARIO_FILE_NAME),
    resolve(process.cwd(), "eval", SCENARIO_FILE_NAME),
    resolve(process.cwd(), SCENARIO_FILE_NAME),
  ];
  const path = candidates.find((item) => existsSync(item));
  if (!path) {
    throw new Error(`Eval scenario file not found: ${SCENARIO_FILE_NAME}`);
  }
  return path;
}

/** 读取并缓存评测集文件（含 JSON 解析） */
export function loadEvalFile(): EvalScenarioFile {
  if (cachedFile) return cachedFile;
  const path = resolveScenarioPath();
  cachedFile = JSON.parse(readFileSync(path, "utf8")) as EvalScenarioFile;
  return cachedFile;
}

/** 读取全部评测场景 */
export function loadEvalScenarios(): EvalScenario[] {
  return loadEvalFile().scenarios;
}

/** 当前 renderer 支持的组件类型（评测集声明） */
export function supportedComponentTypes(): string[] {
  return loadEvalFile().supportedComponents;
}
