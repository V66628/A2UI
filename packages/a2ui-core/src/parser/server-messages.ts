import type { HydrateNode } from "../store/types.js";
import { ErrorType } from "../store/types.js";
import {
  addA2UIError,
  addParseError,
  createNodeToken,
  ensureSurface,
  extractEntryValue,
  upsertHydrateNode,
  type ParseContext,
} from "./context.js";
import { getMountNotifier, getRenderMap } from "./render-registry.js";
import type { ServerMessageKey } from "./types.js";

/**
 * 构造节点的 markMounted 回调（标记清除）：
 * 入场动画结束时把 ctx 中该节点 hasMounted 置 true，并经通知器同步回 store。
 * 幂等：已挂载则直接返回。
 */
function createMarkMounted(
  ctx: ParseContext,
  surfaceId: string,
  componentId: string,
): () => void {
  return () => {
    const node = ctx.nodeMap.get(surfaceId)?.get(componentId);
    if (!node || node.hasMounted) return;
    node.hasMounted = true;
    getMountNotifier()?.(componentId);
  };
}

/**
 * 处理 server→client 方向消息
 * 对应 specification/json/server_to_client.json
 */
export function processServerMessage(
  key: ServerMessageKey,
  body: unknown,
  rawLine: string,
  ctx: ParseContext,
): void {
  if (typeof body !== "object" || body === null) {
    addParseError(ctx, `${key} 消息体必须是对象: ${rawLine}`);
    return;
  }

  switch (key) {
    case "surfaceUpdate":
      handleSurfaceUpdate(body as Record<string, unknown>, rawLine, ctx);
      return;
    case "dataModelUpdate":
      handleDataModelUpdate(body as Record<string, unknown>, ctx);
      return;
    case "beginRendering":
      handleBeginRendering(body as Record<string, unknown>, ctx);
      return;
    case "deleteSurface":
      handleDeleteSurface(body as Record<string, unknown>, ctx);
      return;
  }
}

/** surfaceUpdate：组件定义 → hydrateNode，并调用 renderMap 渲染 */
function handleSurfaceUpdate(
  body: Record<string, unknown>,
  rawLine: string,
  ctx: ParseContext,
): void {
  const { surfaceId, components } = body;
  if (typeof surfaceId !== "string" || !Array.isArray(components)) {
    addParseError(
      ctx,
      "surfaceUpdate 必须包含字符串 surfaceId 与数组 components",
    );
    return;
  }

  const surface = ensureSurface(ctx, surfaceId);

  // 先校验并收集本批次全部组件
  const parsed: Array<{
    componentId: string;
    componentType: string;
    componentProps: unknown;
  }> = [];
  for (const item of components) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.id !== "string" ||
      typeof item.component !== "object" ||
      item.component === null
    ) {
      addParseError(ctx, "surfaceUpdate 中的组件必须包含 id 与 component");
      continue;
    }
    const typeKeys = Object.keys(item.component);
    if (typeKeys.length !== 1) {
      addParseError(
        ctx,
        `component 必须恰好包含一个组件类型键（组件 ${item.id}）`,
      );
      continue;
    }
    parsed.push({
      componentId: item.id,
      componentType: typeKeys[0],
      componentProps: (item.component as Record<string, unknown>)[typeKeys[0]],
    });
  }

  // 阶段一：先注册全部节点（_vnode 暂为 null），使同批次组件引用可互相解析。
  // 新组件打未挂载标记（hasMounted=false）；同 id 再次出现则保留原标记。
  const batchNodes = new Map<string, HydrateNode>();
  for (const { componentId } of parsed) {
    const existing = ctx.nodeMap.get(surface.id)?.get(componentId);
    const node: HydrateNode = {
      componentId,
      nodeToken: createNodeToken(),
      _vnode: null,
      ownerSurfaceId: surface.id,
      protocol: rawLine,
      hasMounted: existing?.hasMounted ?? false,
    };
    upsertHydrateNode(ctx, node);
    batchNodes.set(componentId, node);
  }

  // 阶段二：按 renderMap 逐个渲染，结果写回对应节点
  // renderMap 为 null 表示框架无关模式：不渲染也不报错
  const registeredRenderMap = getRenderMap();
  if (!registeredRenderMap) return;

  for (const { componentId, componentType, componentProps } of parsed) {
    const render = registeredRenderMap[componentType];
    if (!render) {
      // 协议使用了未注册的组件，无法渲染，记录错误（随后由调用方写入 store）
      addA2UIError(ctx, {
        type: ErrorType.COMPONENT_NOT_REGISTERED,
        content:
          `组件类型 "${componentType}" 未在 renderMap 中注册，无法渲染该组件` +
          `（组件 id: "${componentId}"，surface: "${surface.id}"）。` +
          `请检查协议中的组件名，或通过 renderMap 注册 "${componentType}" 对应的渲染器。`,
      });
      continue;
    }
    const batchNode = batchNodes.get(componentId)!;
    batchNode._vnode = render(componentProps, {
      componentId,
      nodeToken: batchNode.nodeToken,
      ownerSurfaceId: surface.id,
      dataModel: surface.dataModel,
      protocol: rawLine,
      resolveNode: (refId: string) =>
        ctx.nodeMap.get(surface.id)?.get(refId) ?? null,
      hasMounted: batchNode.hasMounted,
      markMounted: createMarkMounted(ctx, surface.id, componentId),
    });
  }
}

/** 在协议原文中找到指定组件 id 的类型与 props */
function findProtocolComponent(
  rawLine: string,
  componentId: string,
): { type: string; componentProps: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return null;
  }
  const body = (
    parsed as {
      surfaceUpdate?: {
        components?: Array<{
          id: string;
          component?: Record<string, unknown>;
        }>;
      };
    }
  ).surfaceUpdate;
  const item = body?.components?.find((entry) => entry.id === componentId);
  if (!item || !item.component) return null;
  const typeKeys = Object.keys(item.component);
  if (typeKeys.length !== 1) return null;
  return {
    type: typeKeys[0],
    componentProps: item.component[typeKeys[0]],
  };
}

/**
 * 用当前 renderMap 重新渲染单个既有节点的 _vnode。
 * 流式增量推送后刷新元素引用（不新增错误：未注册组件的错误已在首次处理时记录）。
 */
export function rerenderNode(ctx: ParseContext, node: HydrateNode): void {
  const registeredRenderMap = getRenderMap();
  if (!registeredRenderMap) return;
  const found = findProtocolComponent(node.protocol, node.componentId);
  if (!found) return;
  const render = registeredRenderMap[found.type];
  if (!render) return;
  node._vnode = render(found.componentProps, {
    componentId: node.componentId,
    nodeToken: node.nodeToken,
    ownerSurfaceId: node.ownerSurfaceId,
    dataModel: ctx.surfaceMap.get(node.ownerSurfaceId)?.dataModel,
    protocol: node.protocol,
    resolveNode: (refId: string) =>
      ctx.nodeMap.get(node.ownerSurfaceId)?.get(refId) ?? null,
    hasMounted: node.hasMounted,
    markMounted: createMarkMounted(ctx, node.ownerSurfaceId, node.componentId),
  });
}

/** 为 ctx 中全部节点重新渲染 _vnode（每条流式消息后调用） */
export function rerenderAllNodes(ctx: ParseContext): void {
  for (const node of ctx.nodeOrder) rerenderNode(ctx, node);
}

/** dataModelUpdate：构建/合并该 surface 的数据模型 */
function handleDataModelUpdate(
  body: Record<string, unknown>,
  ctx: ParseContext,
): void {
  const { surfaceId, contents } = body;
  if (typeof surfaceId !== "string" || !Array.isArray(contents)) {
    addParseError(
      ctx,
      "dataModelUpdate 必须包含字符串 surfaceId 与数组 contents",
    );
    return;
  }

  const surface = ensureSurface(ctx, surfaceId);
  if (!surface.dataModel) surface.dataModel = {};

  for (const entry of contents) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.key !== "string"
    ) {
      addParseError(ctx, "dataModelUpdate 的条目必须包含 key");
      continue;
    }
    surface.dataModel[entry.key] = extractEntryValue(entry);
  }
}

/** beginRendering：标记可渲染并解析 root 节点 */
function handleBeginRendering(
  body: Record<string, unknown>,
  ctx: ParseContext,
): void {
  const { surfaceId, root } = body;
  if (typeof surfaceId !== "string" || typeof root !== "string") {
    addParseError(ctx, "beginRendering 必须包含字符串 surfaceId 与 root");
    return;
  }

  const surface = ensureSurface(ctx, surfaceId);
  surface.beginRender = true;

  const rootNode = ctx.nodeMap.get(surfaceId)?.get(root) ?? null;
  if (!rootNode) {
    addParseError(
      ctx,
      `beginRendering 的 root "${root}" 在 surface "${surfaceId}" 中不存在`,
    );
    return;
  }
  surface.rootNode = rootNode;
}

/** deleteSurface：移除 surface 及其节点 */
function handleDeleteSurface(
  body: Record<string, unknown>,
  ctx: ParseContext,
): void {
  const { surfaceId } = body;
  if (typeof surfaceId !== "string") {
    addParseError(ctx, "deleteSurface 必须包含字符串 surfaceId");
    return;
  }

  const perSurface = ctx.nodeMap.get(surfaceId);
  ctx.surfaceMap.delete(surfaceId);
  ctx.nodeMap.delete(surfaceId);
  if (perSurface) {
    ctx.nodeOrder = ctx.nodeOrder.filter(
      (node) =>
        !(
          node.ownerSurfaceId === surfaceId && perSurface.has(node.componentId)
        ),
    );
  }
}
