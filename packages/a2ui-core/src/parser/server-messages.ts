import type { HydrateNode } from "../store/types.js";
import { ErrorType } from "../store/types.js";
import {
  addA2UIError,
  addParseError,
  ensureSurface,
  extractEntryValue,
  upsertHydrateNode,
  type ParseContext,
} from "./context.js";
import { getRenderMap } from "./render-registry.js";
import type { ServerMessageKey } from "./types.js";

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

/** surfaceUpdate：组件定义 → hydrateNode（vnode 暂为 null，由 vnode 模块负责） */
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

    // 解析出需要更新的组件时，调用 renderMap 中对应的 render 渲染组件实例
    const componentType = typeKeys[0];
    const componentProps = (item.component as Record<string, unknown>)[
      componentType
    ];
    let vnode: unknown = null;
    // renderMap 为 null 表示框架无关模式：不渲染也不报错（_vnode 保持 null）
    const registeredRenderMap = getRenderMap();
    if (registeredRenderMap) {
      const render = registeredRenderMap[componentType];
      if (render) {
        vnode = render(componentProps, {
          componentId: item.id,
          ownerSurfaceId: surface.id,
          dataModel: surface.dataModel,
          protocol: rawLine,
        });
      } else {
        // 协议使用了未注册的组件，无法渲染，记录错误（随后由调用方写入 store）
        addA2UIError(ctx, {
          type: ErrorType.COMPONENT_NOT_REGISTERED,
          content:
            `组件类型 "${componentType}" 未在 renderMap 中注册，无法渲染该组件` +
            `（组件 id: "${item.id}"，surface: "${surface.id}"）。` +
            `请检查协议中的组件名，或通过 renderMap 注册 "${componentType}" 对应的渲染器。`,
        });
      }
    }

    const node: HydrateNode = {
      componentId: item.id,
      _vnode: vnode,
      ownerSurfaceId: surface.id,
      protocol: rawLine,
    };
    upsertHydrateNode(ctx, node);
  }
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
