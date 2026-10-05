import React from "react";
import ReactDOM from "react-dom/client";
import {
  createParser,
  getA2UIStore,
  init,
  type TreeRenderFunction,
} from "@a2ui/core";
import { renderMap } from "@a2ui/react";
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

/** 非 SSE 接口调用结果摘要 */
export interface NonSSEResult {
  threadId: string;
  runId: string;
  /** 从事件中解出的 A2UI 消息条数 */
  messageCount: number;
}

/** AG-UI 事件中本应用关心的字段 */
interface AgUIEventLike {
  type: string;
  name?: string;
  value?: unknown;
  message?: string;
}

/**
 * 调用 a2ui-server 的非 SSE 接口（POST /?stream=false）：
 * server 一次性返回 {threadId, runId, events}，从中取出
 * CUSTOM(name="a2ui") 的 value（A2UI 协议消息），重建本地 parser 渲染。
 */
export async function fetchNonSSE(
  input: string,
  renderTree: TreeRenderFunction | null,
): Promise<NonSSEResult> {
  const response = await fetch(`${SERVER_BASE_URL}/?stream=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!response.ok) {
    throw new Error(`server responded ${response.status}`);
  }

  const payload = (await response.json()) as {
    threadId: string;
    runId: string;
    events: AgUIEventLike[];
  };

  const lastEvent = payload.events[payload.events.length - 1];
  if (lastEvent?.type === "RUN_ERROR") {
    throw new Error(lastEvent.message ?? "server RUN_ERROR");
  }

  const lines = payload.events
    .filter((event) => event.type === "CUSTOM" && event.name === "a2ui")
    .map((event) => JSON.stringify(event.value));

  ingestProtocolLines(lines, renderTree);

  return {
    threadId: payload.threadId,
    runId: payload.runId,
    messageCount: lines.length,
  };
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
