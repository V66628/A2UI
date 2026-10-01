import type { ComponentTree } from "../treebuilder/types.js";
import type { RenderMap } from "./types.js";

/**
 * 组件树渲染函数：由使用方通过 init 注入。
 * SDK 在每次 parse → treebuild 后调用，使用方据此把根节点渲染到目标端。
 */
export type TreeRenderFunction = (tree: ComponentTree) => void;

/** 全局 renderMap（由 init 设置，parser 读取） */
let renderMapInstance: RenderMap | null = null;

/** 全局组件树渲染函数（由 init 设置，parser 在 treebuild 后调用） */
let treeRendererInstance: TreeRenderFunction | null = null;

export function setRenderMap(renderMap: RenderMap | null): void {
  renderMapInstance = renderMap;
}

export function getRenderMap(): RenderMap | null {
  return renderMapInstance;
}

export function setTreeRenderer(renderTree: TreeRenderFunction | null): void {
  treeRendererInstance = renderTree;
}

export function getTreeRenderer(): TreeRenderFunction | null {
  return treeRendererInstance;
}

/**
 * 挂载完成通知器：由 init 注册（回写 store 中 node.hasMounted）。
 * parser 在入场动画结束、markMounted 被调用时通知它。
 */
export type MountNotifier = (componentId: string) => void;

let mountNotifierInstance: MountNotifier | null = null;

export function setMountNotifier(notifier: MountNotifier | null): void {
  mountNotifierInstance = notifier;
}

export function getMountNotifier(): MountNotifier | null {
  return mountNotifierInstance;
}
