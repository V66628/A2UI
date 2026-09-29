import {
  ErrorType,
  type A2UIError,
  type HydrateNode,
  type Surface,
} from "../store/types.js";
import type { ClientEvent } from "./types.js";

/** 解析过程中共享的累积上下文 */
export interface ParseContext {
  /** 按插入顺序保存当前有效的 surface */
  surfaceMap: Map<string, Surface>;
  /** surfaceId -> (componentId -> HydrateNode) */
  nodeMap: Map<string, Map<string, HydrateNode>>;
  /** 按出现顺序保存全部 hydrateNode（用于扁平输出） */
  nodeOrder: HydrateNode[];
  errors: A2UIError[];
  clientEvents: ClientEvent[];
}

export function createParseContext(): ParseContext {
  return {
    surfaceMap: new Map(),
    nodeMap: new Map(),
    nodeOrder: [],
    errors: [],
    clientEvents: [],
  };
}

export function addParseError(ctx: ParseContext, content: string): void {
  addA2UIError(ctx, { type: ErrorType.PARSE_ERROR, content });
}

/** 向解析上下文追加任意类型的错误 */
export function addA2UIError(ctx: ParseContext, error: A2UIError): void {
  ctx.errors.push(error);
}

/** 获取或创建 surface，初始 beginRender=false、rootNode=null */
export function ensureSurface(ctx: ParseContext, surfaceId: string): Surface {
  let surface = ctx.surfaceMap.get(surfaceId);
  if (!surface) {
    surface = { id: surfaceId, beginRender: false, rootNode: null };
    ctx.surfaceMap.set(surfaceId, surface);
  }
  return surface;
}

/** 按 surface 维度 upsert 一个 hydrateNode，保持扁平输出顺序 */
export function upsertHydrateNode(ctx: ParseContext, node: HydrateNode): void {
  let perSurface = ctx.nodeMap.get(node.ownerSurfaceId);
  if (!perSurface) {
    perSurface = new Map();
    ctx.nodeMap.set(node.ownerSurfaceId, perSurface);
  }

  const existing = perSurface.get(node.componentId);
  if (existing) {
    // 更新：替换原位置对象，保证既有引用（如 rootNode）拿到最新值
    const index = ctx.nodeOrder.indexOf(existing);
    if (index >= 0) ctx.nodeOrder[index] = node;
  } else {
    ctx.nodeOrder.push(node);
  }
  perSurface.set(node.componentId, node);
}

/** 从 dataModelUpdate 的条目数组中提取类型化值 */
export function extractEntryValue(entry: Record<string, unknown>): unknown {
  if ("valueString" in entry) return entry.valueString;
  if ("valueNumber" in entry) return entry.valueNumber;
  if ("valueBoolean" in entry) return entry.valueBoolean;
  if ("valueMap" in entry) {
    const map = Array.isArray(entry.valueMap) ? entry.valueMap : [];
    return Object.fromEntries(map.map((kv) => [kv.key, extractEntryValue(kv)]));
  }
  return null;
}
