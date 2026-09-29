import {
  addParseError,
  type ParseContext,
} from "./context.js";
import type { ClientMessageKey, UserAction } from "./types.js";

/** userAction 必填字段（对应 client_to_server.json） */
const USER_ACTION_REQUIRED = [
  "name",
  "surfaceId",
  "sourceComponentId",
  "timestamp",
  "context",
] as const;

/**
 * 处理 client→server 方向消息
 * 对应 specification/json/client_to_server.json
 *
 * 与 server→client 完全分开：解析结果单独归入 clientEvents，
 * 不创建 surface / hydrateNode。
 */
export function processClientMessage(
  key: ClientMessageKey,
  body: unknown,
  rawLine: string,
  ctx: ParseContext
): void {
  if (typeof body !== "object" || body === null) {
    addParseError(ctx, `${key} 消息体必须是对象: ${rawLine}`);
    return;
  }

  const payload = body as Record<string, unknown>;

  if (key === "userAction") {
    for (const field of USER_ACTION_REQUIRED) {
      if (!(field in payload)) {
        addParseError(ctx, `userAction 缺少必填字段 "${field}"`);
        return;
      }
    }
    const { name, surfaceId, sourceComponentId, timestamp, context } = payload;
    if (
      typeof name !== "string" ||
      typeof surfaceId !== "string" ||
      typeof sourceComponentId !== "string" ||
      typeof timestamp !== "string" ||
      typeof context !== "object" ||
      context === null
    ) {
      addParseError(ctx, "userAction 字段类型不符合协议");
      return;
    }
    const userAction: UserAction = {
      name,
      surfaceId,
      sourceComponentId,
      timestamp,
      context: context as Record<string, unknown>,
    };
    ctx.clientEvents.push({ type: "userAction", payload: userAction, protocol: rawLine });
    return;
  }

  // error：协议允许灵活内容
  ctx.clientEvents.push({ type: "error", payload, protocol: rawLine });
}
