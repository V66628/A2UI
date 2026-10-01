import { buildTree } from "../treebuilder/index.js";
import { processClientMessage } from "./client-messages.js";
import { addParseError, type ParseContext } from "./context.js";
import { processServerMessage } from "./server-messages.js";
import type {
  ClientMessageKey,
  ParseResult,
  ServerMessageKey,
} from "./types.js";

/** server→client 合法消息键 */
export const SERVER_MESSAGE_KEYS: readonly ServerMessageKey[] = [
  "surfaceUpdate",
  "dataModelUpdate",
  "beginRendering",
  "deleteSurface",
];

/** client→server 合法消息键 */
export const CLIENT_MESSAGE_KEYS: readonly ClientMessageKey[] = [
  "userAction",
  "error",
];

/**
 * 处理一条 A2UI 消息（parseProtocol 与有状态 parser 共用）
 *
 * 输入支持两种形态：
 * - string：一行 JSONL 消息（空行忽略；JSON 解析失败记 PARSE_ERROR）
 * - object：已解析的消息对象（按单动作键校验后直接分发）
 *
 * 校验单动作键 → 按方向分发；错误写入 ctx，不抛出。
 */
export function processInput(
  ctx: ParseContext,
  input: string | Record<string, unknown>,
): void {
  let message: unknown;
  let rawLine: string;

  if (typeof input === "string") {
    const line = input.trim();
    if (!line) return;
    rawLine = line;
    try {
      message = JSON.parse(line);
    } catch {
      addParseError(ctx, `无法解析的 JSON 行: ${line}`);
      return;
    }
  } else {
    // 对象输入：序列化为规范原文，供节点 protocol 字段与后续重渲染使用
    message = input;
    rawLine = JSON.stringify(input);
  }

  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    addParseError(ctx, `消息必须是 JSON 对象: ${rawLine}`);
    return;
  }

  const keys = Object.keys(message);
  if (keys.length !== 1) {
    addParseError(ctx, `消息必须恰好包含一个动作键: ${rawLine}`);
    return;
  }

  const key = keys[0];

  if ((SERVER_MESSAGE_KEYS as readonly string[]).includes(key)) {
    processServerMessage(
      key as ServerMessageKey,
      (message as Record<string, unknown>)[key],
      rawLine,
      ctx,
    );
  } else if ((CLIENT_MESSAGE_KEYS as readonly string[]).includes(key)) {
    processClientMessage(
      key as ClientMessageKey,
      (message as Record<string, unknown>)[key],
      rawLine,
      ctx,
    );
  } else {
    addParseError(ctx, `未知的消息类型: ${key}`);
  }
}

/** 基于当前 ctx 为每个 surface 构建组件树 */
export function buildTreesForContext(ctx: ParseContext): ParseResult["trees"] {
  return [...ctx.surfaceMap.values()].map((surface) =>
    buildTree(
      ctx.nodeMap.get(surface.id)
        ? [...ctx.nodeMap.get(surface.id)!.values()]
        : [],
      surface.rootNode?.componentId,
      surface.id,
    ),
  );
}

/** 从累积上下文生成当前快照 */
export function snapshotContext(ctx: ParseContext): ParseResult {
  return {
    surfaces: [...ctx.surfaceMap.values()],
    hydrateNodes: ctx.nodeOrder,
    errors: ctx.errors,
    clientEvents: ctx.clientEvents,
    trees: buildTreesForContext(ctx),
  };
}
