import { addParseError, createParseContext } from "./context.js";
import { processClientMessage } from "./client-messages.js";
import { processServerMessage } from "./server-messages.js";
import { buildTree } from "../treebuilder/index.js";
import type {
  ClientMessageKey,
  ParseResult,
  ServerMessageKey,
} from "./types.js";

export * from "./types.js";
export * from "./binding.js";

/** server→client 合法消息键 */
const SERVER_MESSAGE_KEYS: readonly ServerMessageKey[] = [
  "surfaceUpdate",
  "dataModelUpdate",
  "beginRendering",
  "deleteSurface",
];

/** client→server 合法消息键 */
const CLIENT_MESSAGE_KEYS: readonly ClientMessageKey[] = [
  "userAction",
  "error",
];

/**
 * 解析 A2UI JSONL 协议
 *
 * - A2UI 以 JSON Lines 传输：每行一个 JSON 消息，空行忽略
 * - 按消息键判别方向，server→client 与 client→server 分开处理：
 *   server 消息构建 surfaces / hydrateNodes，client 消息归入 clientEvents
 * - 任意单行错误记录为 PARSE_ERROR，不中断整段解析
 */
export function parseProtocol(jsonl: string): ParseResult {
  const ctx = createParseContext();
  const lines = jsonl.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      addParseError(ctx, `无法解析的 JSON 行: ${line}`);
      continue;
    }

    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    ) {
      addParseError(ctx, `消息必须是 JSON 对象: ${line}`);
      continue;
    }

    const keys = Object.keys(message);
    if (keys.length !== 1) {
      addParseError(ctx, `消息必须恰好包含一个动作键: ${line}`);
      continue;
    }

    const key = keys[0];

    if ((SERVER_MESSAGE_KEYS as readonly string[]).includes(key)) {
      processServerMessage(
        key as ServerMessageKey,
        (message as Record<string, unknown>)[key],
        line,
        ctx,
      );
    } else if ((CLIENT_MESSAGE_KEYS as readonly string[]).includes(key)) {
      processClientMessage(
        key as ClientMessageKey,
        (message as Record<string, unknown>)[key],
        line,
        ctx,
      );
    } else {
      addParseError(ctx, `未知的消息类型: ${key}`);
    }
  }

  // 解析完成后调用 treebuilder，为每个 surface 构建组件树
  const trees = [...ctx.surfaceMap.values()].map((surface) => {
    const perSurfaceNodes = ctx.nodeMap.get(surface.id);
    return buildTree(
      perSurfaceNodes ? [...perSurfaceNodes.values()] : [],
      surface.rootNode?.componentId,
      surface.id,
    );
  });

  return {
    surfaces: [...ctx.surfaceMap.values()],
    hydrateNodes: ctx.nodeOrder,
    errors: ctx.errors,
    clientEvents: ctx.clientEvents,
    trees,
  };
}
