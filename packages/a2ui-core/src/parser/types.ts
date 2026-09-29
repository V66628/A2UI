import type { ComponentTree } from "../treebuilder/types.js";
import type { A2UIError, HydrateNode, Surface } from "../store/types.js";

/** 消息方向 */
export type MessageDirection = "server-to-client" | "client-to-server";

/** server→client 消息键 */
export type ServerMessageKey =
  | "surfaceUpdate"
  | "dataModelUpdate"
  | "beginRendering"
  | "deleteSurface";

/** client→server 消息键 */
export type ClientMessageKey = "userAction" | "error";

/** userAction 载荷（对应 client_to_server.json） */
export interface UserAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

/** 解析后的 client→server 事件 */
export interface ClientEvent {
  type: ClientMessageKey;
  /** userAction 为结构化载荷；error 为灵活对象 */
  payload: UserAction | Record<string, unknown>;
  /** JSONL 协议原文 */
  protocol: string;
}

/** renderer 渲染时的上下文 */
export interface RenderContext {
  /** 当前组件 id */
  componentId: string;
  /** 所属 surface id */
  ownerSurfaceId: string;
  /** 所属 surface 的数据模型（用于解析 path 绑定） */
  dataModel?: Record<string, unknown>;
  /** JSONL 协议原文 */
  protocol: string;
}

/**
 * 组件渲染函数：由具体 UI 框架（如 a2ui-react）实现，
 * 返回该框架的组件实例（React 环境下为 ReactElement）。
 * a2ui-core 只调用、不感知框架。
 */
export type RenderFunction = (
  props: unknown,
  context: RenderContext,
) => unknown;

/** 组件类型 -> 渲染函数 的映射 */
export type RenderMap = Record<string, RenderFunction>;

/** parseProtocol 解析结果（未提供 renderMap 时 _vnode 为 null） */
export interface ParseResult {
  surfaces: Surface[];
  hydrateNodes: HydrateNode[];
  errors: A2UIError[];
  /** client→server 方向的消息单独归集于此 */
  clientEvents: ClientEvent[];
  /** 解析完成后为每个 surface 构建的组件树 */
  trees: ComponentTree[];
}
