import type { HydrateNode } from "../store/types.js";
import type { ComponentTree, ComponentTreeNode } from "./types.js";

export * from "./types.js";

/**
 * 从节点协议原文中解析它引用的子组件 id
 *
 * 支持的组件引用形态（见 specification/json/standard_catalog_definition.json）：
 * - child: string（如 Button / Card 的单子组件）
 * - children.explicitList: string[]（如 Row / Column / List 的显式子组件列表）
 *
 * 解析失败或无引用时返回空数组；children.template（数据驱动）暂不支持。
 */
export function extractChildIds(node: HydrateNode): string[] {
  let message: unknown;
  try {
    message = JSON.parse(node.protocol);
  } catch {
    return [];
  }

  const components = (
    message as {
      surfaceUpdate?: { components?: unknown };
    }
  ).surfaceUpdate?.components;
  if (!Array.isArray(components)) return [];

  const item = components.find(
    (
      entry,
    ): entry is {
      id: string;
      component: Record<string, Record<string, unknown>>;
    } =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { id?: unknown }).id === node.componentId,
  );
  if (!item) return [];

  const [componentType] = Object.keys(item.component);
  const props = item.component[componentType];

  const childIds: string[] = [];
  if (typeof props.child === "string") childIds.push(props.child);
  const childrenContainer = props.children as
    | { explicitList?: unknown }
    | undefined;
  const explicitList = childrenContainer?.explicitList;
  if (Array.isArray(explicitList)) {
    for (const id of explicitList)
      if (typeof id === "string") childIds.push(id);
  }
  return childIds;
}

/**
 * 将 hydrateNode 组装为组件树（parent/children 结构）
 *
 * - 根据协议中的组件引用（child / children.explicitList）递归组装子节点
 * - 被引用但在当前节点集合中不存在的子 id 跳过；环引用经访问集合保护
 *
 * 根节点定位：
 * 1. beginRendering 指定的 rootId
 * 2. 只有一个节点时以该节点为根
 * 3. 取“未被任何节点引用”的节点；恰好一个时以其为根
 */
export function buildTree(
  hydrateNodes: HydrateNode[],
  rootId: string | undefined,
  surfaceId: string,
): ComponentTree {
  const nodeById = new Map(
    hydrateNodes.map((node) => [node.componentId, node]),
  );

  // 递归构建：先确保子节点完成组装，再挂到父节点
  const buildNode = (
    hydrateNode: HydrateNode,
    visiting: Set<string>,
  ): ComponentTreeNode => {
    const children: ComponentTreeNode[] = [];
    for (const childId of extractChildIds(hydrateNode)) {
      const childNode = nodeById.get(childId);
      if (!childNode || visiting.has(childId)) continue;
      visiting.add(childId);
      children.push(buildNode(childNode, visiting));
    }
    return { node: hydrateNode, children };
  };

  let rootHydrate: HydrateNode | undefined;
  if (rootId) rootHydrate = nodeById.get(rootId);
  if (!rootHydrate && hydrateNodes.length === 1) {
    rootHydrate = hydrateNodes[0];
  }
  if (!rootHydrate) {
    // 反推根：全部 id 减去被引用 id
    const referencedIds = new Set<string>();
    for (const node of hydrateNodes) {
      for (const childId of extractChildIds(node)) referencedIds.add(childId);
    }
    const unreferenced = hydrateNodes.filter(
      (node) => !referencedIds.has(node.componentId),
    );
    if (unreferenced.length === 1) rootHydrate = unreferenced[0];
  }

  const root: ComponentTree["root"] = rootHydrate
    ? buildNode(rootHydrate, new Set([rootHydrate.componentId]))
    : null;

  return { surfaceId, root };
}
