/**
 * store 类型定义
 *
 * 设计说明：
 * - HydrateNode._vnode 使用泛型 VNode 表达，默认 unknown，
 *   使 a2ui-core 不依赖任何 UI 框架（React 环境下可指定为 ReactElement）。
 */

/** 错误类型 */
export enum ErrorType {
  PARSE_ERROR = "PARSE_ERROR",
  /** 协议中使用的组件未在 renderMap 中注册 */
  COMPONENT_NOT_REGISTERED = "COMPONENT_NOT_REGISTERED",
}

/** A2UI 错误信息 */
export interface A2UIError {
  type: ErrorType;
  content: string;
}

/**
 * 水合组件节点
 * 由 a2ui 协议映射而来
 */
export interface HydrateNode<VNode = unknown> {
  /** 组件 ID */
  componentId: string;
  /**
   * 节点实例代标识：parser 每次创建节点（含同 id 组件在新 parser/ctx 中
   * 重新出现）时生成的唯一 token。MountFade 据此判断是否为需要重新播放
   * 入场动画的新节点——即使 React 复用了同 componentId 的组件实例。
   */
  nodeToken: string;
  /** 框架无关的虚拟节点（React 环境下为 ReactElement） */
  _vnode: VNode;
  /** 所属 surface ID */
  ownerSurfaceId: string;
  /** JSONL 协议原文 */
  protocol: string;
  /**
   * 是否已挂载（标记清除）：
   * parser 首次识别新组件时置 false（标记），
   * 入场动画结束后经暴露的 markMounted 回写为 true（清除）。
   * 同 id 组件再次 surfaceUpdate 不重置该标记。
   */
  hasMounted: boolean;
}

/** 渲染表面 */
export interface Surface<VNode = unknown> {
  /** surface ID */
  id: string;
  /** 是否已开始渲染 */
  beginRender: boolean;
  /** 根组件节点 */
  rootNode: HydrateNode<VNode> | null;
  /** 数据模型（协议规定每个 surface 拥有独立数据模型） */
  dataModel?: Record<string, unknown>;
}

/**
 * A2UI store 状态
 * 包含：原始协议、surfaceMap、hydrateNodeMap、errorMap
 * 以及针对三张 Map 按 id 维度的增 / 删 / 改 / 查操作
 */
export interface A2UIStoreState<VNode = unknown> {
  /** 原始协议 */
  rawProtocol: string;
  setRawProtocol: (protocol: string) => void;

  /** surface 管理 */
  surfaceMap: Record<string, Surface<VNode>>;
  addSurface: (surface: Surface<VNode>) => void;
  removeSurface: (id: string) => void;
  updateSurface: (
    id: string,
    patch: Partial<Omit<Surface<VNode>, "id">>,
  ) => void;
  getSurface: (id: string) => Surface<VNode> | undefined;

  /** 组件节点管理（按 componentId 索引） */
  hydrateNodeMap: Record<string, HydrateNode<VNode>>;
  addHydrateNode: (node: HydrateNode<VNode>) => void;
  removeHydrateNode: (componentId: string) => void;
  updateHydrateNode: (
    componentId: string,
    patch: Partial<Omit<HydrateNode<VNode>, "componentId">>,
  ) => void;
  getHydrateNode: (componentId: string) => HydrateNode<VNode> | undefined;

  /** 错误信息管理（按 error id 索引） */
  errorMap: Record<string, A2UIError>;
  addError: (id: string, error: A2UIError) => void;
  removeError: (id: string) => void;
  updateError: (id: string, patch: Partial<A2UIError>) => void;
  getError: (id: string) => A2UIError | undefined;
}
