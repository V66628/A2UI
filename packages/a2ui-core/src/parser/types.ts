import type { ComponentTree } from "../treebuilder/types.js";
import type { A2UIError, HydrateNode, Surface } from "../store/types.js";
import type { ChildrenTemplate, TemplateChild } from "./template.js";

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
  /** 当前节点实例代标识：每次创建节点都不同，供 renderMap 识别新节点实例 */
  nodeToken: string;
  /** 所属 surface id */
  ownerSurfaceId: string;
  /** 所属 surface 的数据模型（用于解析 path 绑定） */
  dataModel?: Record<string, unknown>;
  /** JSONL 协议原文 */
  protocol: string;
  /**
   * 在同一 surface 内按组件 id 解析被引用的组件节点
   * （用于 Column.children / Button.child 等组件引用；
   * 建议在组件实际 render 时惰性调用）
   */
  resolveNode?: (componentId: string) => HydrateNode | null;
  /**
   * 渲染 children.template 的动态子项：由 parser 按当前数据模型与 item
   * 作用域解析模板，返回各子项 vnode（容器适配器惰性调用）。
   */
  resolveTemplate?: (template: ChildrenTemplate) => TemplateChild[];
  /**
   * 当前节点是否已挂载：false 表示新识别组件，renderMap 可据此播放入场动画。
   */
  hasMounted: boolean;
  /**
   * 入场动画结束时调用：清除标记——parser 把 ctx 中该节点 hasMounted
   * 置为 true，并经 init 注册的通知器同步回 store。幂等。
   */
  markMounted: () => void;
  /**
   * 本地乐观写（交互组件 path 绑定输入）：按 path 深写入所属 surface
   * 数据模型，parser 随后自动 rerenderAllNodes 重渲染。
   */
  writeDataModel?: (path: string, value: unknown) => void;
  /**
   * 派发 userAction（如 Button 点击）：name 取自组件 action.name，
   * context 为绑定解析后的对象；parser 补齐 timestamp 后交出口 sink。
   */
  emitUserAction?: (name: string, context: Record<string, unknown>) => void;
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
