import type { HydrateNode } from "../store/types.js";

/** 组件树节点：包装 hydrateNode 并持有子节点 */
export interface ComponentTreeNode {
  /** 对应的 hydrateNode（含 _vnode） */
  node: HydrateNode;
  /** 子组件树节点（parent/children 关系组装后填充） */
  children: ComponentTreeNode[];
}

/** 一个 surface 对应的组件树 */
export interface ComponentTree {
  /** 所属 surface id */
  surfaceId: string;
  /** 根树节点；无法确定根时为 null */
  root: ComponentTreeNode | null;
}
