import React from "react";
import ReactDOM from "react-dom/client";
import {
  createParser,
  getA2UIStore,
  init,
  type TreeRenderFunction,
} from "@a2ui/core";
import { renderMap } from "@a2ui/react";
import "./index.css";
import App from "./App";

/** mock TS 模块形态：导出 A2UI 消息数组 */
type MockModule = { messages: string[] };

/**
 * 引入 mock 目录下全部 TS mock 模块（非 raw：直接拿到模块导出）。
 * 每个模块导出 messages: string[] —— A2UI 消息数组。
 */
const mockModules = import.meta.glob<MockModule>(
  "../../../packages/a2ui-core/mock/*.ts",
  { eager: true },
);

/** mock 目录条目 */
export interface MockEntry {
  id: string;
  label: string;
  /** A2UI 消息数组（每个元素为一条单行 JSON 字符串） */
  messages: string[];
}

/** 从文件路径生成稳定标识（去 .ts 与 -messages 后缀） */
function mockIdFromPath(path: string): string {
  return path
    .split("/")
    .pop()!
    .replace(/\.ts$/, "")
    .replace(/-messages$/, "");
}

// 按文件名排序，保证按钮顺序稳定
const mockCatalog: MockEntry[] = Object.entries(mockModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, mod]) => {
    const id = mockIdFromPath(path);
    return { id, label: id, messages: mod.messages };
  });

/**
 * 将一组 A2UI 消息灌入全新 parser 并同步最终结果到 store：
 * 1. init 创建全新 store（即重置旧数据），并注入组件树渲染函数；
 *    每次 parse 完成 treebuild 后，SDK 内部自动调用该函数渲染组件树
 * 2. 创建天然有状态的 parser，逐条处理全部消息
 * 3. 将最终结果写入 store（供 store / 错误面板查看）
 *
 * 消息来源可为本地 mock，也可为 server 接口返回的协议。
 */
function ingestProtocolLines(
  lines: string[],
  renderTree: TreeRenderFunction | null,
): void {
  init("", renderMap, renderTree);
  const storeState = getA2UIStore().getState();
  const parser = createParser();

  for (const line of lines) parser.parse(line);
  const result = parser.getResult();

  result.hydrateNodes.forEach((node) => storeState.addHydrateNode(node));
  result.surfaces.forEach((surface) => storeState.addSurface(surface));
  result.errors.forEach((error, index) =>
    storeState.addError(`a2ui-error-${index}`, error),
  );
  storeState.setRawProtocol(lines.join("\n"));
}

/**
 * 加载指定 mock（消息来自本地 mock 文件）
 */
export function loadMock(
  id: string,
  renderTree: TreeRenderFunction | null,
): { entry: MockEntry } {
  const entry = mockCatalog.find((item) => item.id === id) ?? mockCatalog[0];
  ingestProtocolLines(entry.messages, renderTree);
  return { entry };
}

/** a2ui-server 默认地址 */
const SERVER_BASE_URL = "http://localhost:8787";

/** Agent 运行结果摘要 */
export interface AgentRunResult {
  threadId: string;
  runId: string;
  /** 从事件流中解出的 A2UI 协议消息条数 */
  messageCount: number;
}

/** AG-UI 事件中本应用关心的字段 */
interface AgUIEventLike {
  type: string;
  name?: string;
  value?: unknown;
  message?: string;
  threadId?: string;
  runId?: string;
}

/** streamAgentRun 的阶段回调（驱动 UI 的「生成中 / 渲染中」状态） */
export interface AgentRunHooks {
  /** RUN_STARTED：运行已开始，模型开始生成协议 */
  onStart?: (info: { threadId: string; runId: string }) => void;
  /** 每收到一条 CUSTOM/a2ui 协议消息（已增量解析并渲染） */
  onProtocol?: (info: { received: number }) => void;
}

/**
 * 调用 a2ui-server 的 SSE 流式接口（POST /，默认 stream=true）：
 * 先重置出全新空 store 与 parser；随后逐帧消费 AG-UI 事件：
 *   RUN_STARTED               → hooks.onStart
 *   CUSTOM(name="a2ui")       → 将 value 作为一行协议喂给 parser 增量解析，
 *                                同步 store（SDK 同时自动重渲染预览）→ hooks.onProtocol
 *   RUN_ERROR                 → 抛错（由调用方展示红色失败状态）
 *   RUN_FINISHED              → 正常结束，返回摘要
 */
export async function streamAgentRun(
  input: string,
  renderTree: TreeRenderFunction | null,
  hooks: AgentRunHooks = {},
): Promise<AgentRunResult> {
  resetForStreaming(renderTree);
  const parser = createParser();
  let consumedRaw = "";
  let a2uiCount = 0;

  const response = await fetch(`${SERVER_BASE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!response.ok) {
    throw new Error(`server responded ${response.status}`);
  }
  if (!response.body) throw new Error("server returned no stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let threadId = "";
  let runId = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as AgUIEventLike;

      if (event.type === "RUN_STARTED") {
        threadId = event.threadId ?? "";
        runId = event.runId ?? "";
        hooks.onStart?.({ threadId, runId });
      } else if (event.type === "CUSTOM" && event.name === "a2ui") {
        const protocolLine = JSON.stringify(event.value);
        consumedRaw = consumedRaw
          ? `${consumedRaw}\n${protocolLine}`
          : protocolLine;
        const result = parser.parse(protocolLine);
        a2uiCount += 1;
        getA2UIStore().setState({
          rawProtocol: consumedRaw,
          surfaceMap: Object.fromEntries(
            result.surfaces.map((surface) => [surface.id, surface]),
          ),
          hydrateNodeMap: Object.fromEntries(
            result.hydrateNodes.map((node) => [node.componentId, node]),
          ),
          errorMap: Object.fromEntries(
            result.errors.map((error, index) => [
              `a2ui-error-${index}`,
              error,
            ]),
          ),
        });
        hooks.onProtocol?.({ received: a2uiCount });
      } else if (event.type === "RUN_ERROR") {
        throw new Error(event.message ?? "server RUN_ERROR");
      } else if (event.type === "RUN_FINISHED") {
        threadId = event.threadId ?? threadId;
        runId = event.runId ?? runId;
      }
    }
  }

  return { threadId, runId, messageCount: a2uiCount };
}

/**
 * 模型对话：调用 POST /chat（SSE 流式）：
 * 每收到 {delta} 帧回调 onDelta 追加文本；{done:true} 正常结束；
 * {error} 帧（或 HTTP 非 2xx）抛错。
 */
export async function streamChatReply(
  input: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${SERVER_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`server responded ${response.status}`);
  }
  if (!response.body) throw new Error("server returned no stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6)) as {
        delta?: string;
        done?: boolean;
        error?: string;
      };
      if (payload.error) throw new Error(payload.error);
      if (payload.delta) onDelta(payload.delta);
    }
  }
}

/**
 * 流式推送前的准备：创建全新空 store，并保留同一组件树渲染函数，
 * 随后由调用方用 parser 逐条推送（SDK 内部 treebuild 后自动渲染）
 */
export function resetForStreaming(renderTree: TreeRenderFunction | null): void {
  init("", renderMap, renderTree);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App catalog={mockCatalog} initialMockId={mockCatalog[0].id} />
  </React.StrictMode>,
);
