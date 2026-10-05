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

/**
 * 引擎钩子：由 createParser 注册（parser 实例持有 ctx），
 * 供 renderMap 渲染出的交互组件回调——本地乐观写与 userAction 派发。
 */
export interface EngineHooks {
  /** 本地写：按 path 深写入 surface 数据模型，并触发一次重渲染 cycle */
  commitLocalWrite: (surfaceId: string, path: string, value: unknown) => void;
  /** 派发 userAction：parser 补齐 timestamp 等后交 ActionSink */
  dispatchUserAction: (
    surfaceId: string,
    sourceComponentId: string,
    name: string,
    context: Record<string, unknown>,
  ) => void;
}

let engineHooksInstance: EngineHooks | null = null;

export function setEngineHooks(hooks: EngineHooks | null): void {
  engineHooksInstance = hooks;
}

export function getEngineHooks(): EngineHooks | null {
  return engineHooksInstance;
}

/** userAction 出口：由 init 注册（写入 SDK outgoing 队列等） */
export type ActionSink = (action: import("./types.js").UserAction) => void;

let actionSinkInstance: ActionSink | null = null;

export function setActionSink(sink: ActionSink | null): void {
  actionSinkInstance = sink;
}

export function getActionSink(): ActionSink | null {
  return actionSinkInstance;
}

/**
 * 本地状态变化通知器：本地写触发重渲染 cycle 后调用，
 * init 注册后据此把快照 mirror 进全局 store（不动 rawProtocol）。
 */
export type LocalChangeNotifier = (result: import("./types.js").ParseResult) => void;

let localChangeNotifierInstance: LocalChangeNotifier | null = null;

export function setLocalChangeNotifier(notifier: LocalChangeNotifier | null): void {
  localChangeNotifierInstance = notifier;
}

export function getLocalChangeNotifier(): LocalChangeNotifier | null {
  return localChangeNotifierInstance;
}

/**
 * 数据模型桥（由 init 注册，zustand 中心 store 支撑）：
 * dataModelUpdate 在 parse 时首先经此写入中心 store；
 * 渲染期对数据模型的全部消费（RenderContext.dataModel）也经此从 store 读取，
 * 中心 store 是数据模型的唯一数据源。
 */
export interface DataModelBridge {
  /** 确保中心 store 中存在该 surface（dataModelUpdate 可能是首条消息） */
  ensureSurface: (surfaceId: string) => void;
  /** 从中心 store 读取该 surface 的数据模型 */
  getDataModel: (
    surfaceId: string,
  ) => Record<string, unknown> | undefined;
  /** 把 dataModelUpdate（path 替换 / 深写语义）应用到中心 store */
  applyDataModelUpdate: (
    surfaceId: string,
    path: unknown,
    contents: unknown[],
  ) => void;
  /** 本地乐观写入中心 store */
  commitLocalWrite: (
    surfaceId: string,
    path: string,
    value: unknown,
  ) => void;
}

let dataModelBridgeInstance: DataModelBridge | null = null;

export function setDataModelBridge(bridge: DataModelBridge | null): void {
  dataModelBridgeInstance = bridge;
}

export function getDataModelBridge(): DataModelBridge | null {
  return dataModelBridgeInstance;
}
