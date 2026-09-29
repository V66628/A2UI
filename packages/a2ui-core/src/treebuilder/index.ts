import type { HydrateNode } from "../store/types.js";
import type { ComponentTree, ComponentTreeNode } from "./types.js";

export * from "./types.js";

/**
 * 将 hydrateNode 组装为组件树
 *
 * 当前为基础骨架：
 * - 根据 rootId（beginRendering 指定的根）定位根节点
 * - 未指定 rootId 且只有一个节点时，以该节点为根
 *
 * TODO: 实际的树组装——按协议中组件之间的 children 关系
 * （如 Row/Column 的子组件引用）构建多层级 children，当前 mock
 * 只有单个组件，暂不实现。
 */
export function buildTree(
  hydrateNodes: HydrateNode[],
  rootId: string | undefined,
  surfaceId: string
): ComponentTree {
  let rootNode: HydrateNode | undefined;

  if (rootId) {
    rootNode = hydrateNodes.find((node) => node.componentId === rootId);
  } else if (hydrateNodes.length === 1) {
    rootNode = hydrateNodes[0];
  }

  const root: ComponentTreeNode | null = rootNode
    ? { node: rootNode, children: [] }
    : null;

  return { surfaceId, root };
}
