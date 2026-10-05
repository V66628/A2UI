import { createStore, type StoreApi } from "zustand/vanilla";
import {
  applyDataModelUpdate,
  commitLocalWrite,
} from "../parser/data-model.js";
import {
  setActionSink,
  setDataModelBridge,
  setLocalChangeNotifier,
  setMountNotifier,
  setRenderMap,
  setTreeRenderer,
  type TreeRenderFunction,
} from "../parser/render-registry.js";
import type { RenderMap, UserAction } from "../parser/types.js";
import type { A2UIStoreState, Surface } from "./types.js";

export * from "./types.js";

/** store 实例类型（zustand vanilla，无 React 依赖） */
export type A2UIStore<VNode = unknown> = StoreApi<A2UIStoreState<VNode>>;

/**
 * 创建一个 A2UI store 实例
 * 可用于需要独立 store 的场景（如测试）
 */
export function createA2UIStore<VNode = unknown>(): A2UIStore<VNode> {
  return createStore<A2UIStoreState<VNode>>()((set, get) => ({
    // ---- 原始协议 ----
    rawProtocol: "",
    setRawProtocol: (protocol) => set({ rawProtocol: protocol }),

    // ---- surfaceMap：增 / 删 / 改 / 查 ----
    surfaceMap: {},
    addSurface: (surface) =>
      set((state) => ({
        surfaceMap: { ...state.surfaceMap, [surface.id]: surface },
      })),
    removeSurface: (id) =>
      set((state) => {
        const { [id]: _removed, ...rest } = state.surfaceMap;
        return { surfaceMap: rest };
      }),
    updateSurface: (id, patch) =>
      set((state) => {
        const current = state.surfaceMap[id];
        if (!current) return state;
        return {
          surfaceMap: {
            ...state.surfaceMap,
            [id]: { ...current, ...patch },
          },
        };
      }),
    getSurface: (id) => get().surfaceMap[id],

    // ---- hydrateNodeMap：增 / 删 / 改 / 查 ----
    hydrateNodeMap: {},
    addHydrateNode: (node) =>
      set((state) => ({
        hydrateNodeMap: {
          ...state.hydrateNodeMap,
          [node.componentId]: node,
        },
      })),
    removeHydrateNode: (componentId) =>
      set((state) => {
        const { [componentId]: _removed, ...rest } = state.hydrateNodeMap;
        return { hydrateNodeMap: rest };
      }),
    updateHydrateNode: (componentId, patch) =>
      set((state) => {
        const current = state.hydrateNodeMap[componentId];
        if (!current) return state;
        return {
          hydrateNodeMap: {
            ...state.hydrateNodeMap,
            [componentId]: { ...current, ...patch },
          },
        };
      }),
    getHydrateNode: (componentId) => get().hydrateNodeMap[componentId],

    // ---- errorMap：增 / 删 / 改 / 查 ----
    errorMap: {},
    addError: (id, error) =>
      set((state) => ({
        errorMap: { ...state.errorMap, [id]: error },
      })),
    removeError: (id) =>
      set((state) => {
        const { [id]: _removed, ...rest } = state.errorMap;
        return { errorMap: rest };
      }),
    updateError: (id, patch) =>
      set((state) => {
        const current = state.errorMap[id];
        if (!current) return state;
        return {
          errorMap: {
            ...state.errorMap,
            [id]: { ...current, ...patch },
          },
        };
      }),
    getError: (id) => get().errorMap[id],
  }));
}

// ---- 全局单例 ----
let storeInstance: A2UIStore | null = null;

// ---- outgoing userAction 队列 ----
let outgoingActions: UserAction[] = [];
const outgoingListeners = new Set<() => void>();

/** 获取当前 outgoing userAction 队列（数组引用仅在增删时改变） */
export function getOutgoingActions(): readonly UserAction[] {
  return outgoingActions;
}

/** 订阅队列变化（供 useSyncExternalStore）；返回取消订阅函数 */
export function subscribeOutgoingActions(listener: () => void): () => void {
  outgoingListeners.add(listener);
  return () => {
    outgoingListeners.delete(listener);
  };
}

/** 清空 outgoing 队列并通知订阅者 */
export function clearOutgoingActions(): void {
  if (outgoingActions.length === 0) return;
  outgoingActions = [];
  outgoingListeners.forEach((listener) => listener());
}

/**
 * 获取全局唯一的 A2UI store 实例（懒加载单例）
 *
 * 可通过泛型指定 vnode 类型，例如：
 *   const store = getA2UIStore<ReactElement>();
 */
export function getA2UIStore<VNode = unknown>(): A2UIStore<VNode> {
  if (!storeInstance) {
    storeInstance = createA2UIStore();
  }
  return storeInstance as A2UIStore<VNode>;
}

/**
 * 初始化 A2UI 全局实例
 *
 * - 调用 createStore 创建一个全新的 store 并设为全局单例（即重置状态）
 * - renderMap：组件类型 -> 渲染函数，parser 解析组件时据此渲染 _vnode；
 *   不传则 _vnode 为 null（框架无关模式）
 * - renderTree：组件树渲染函数；SDK 内部决定调用时机——每次 parse 完成
 *   treebuild 后自动调用，使用方据此把组件树渲染到目标端；不传则不调用
 * - 同时注册挂载完成通知器：renderMap 的入场动画结束、markMounted 被调用时，
 *   把 store 中对应 node.hasMounted 置为 true（幂等）
 * - 可选传入初始协议
 * - 初始化后可通过 getA2UIStore() 获取同一实例
 */
export function init<VNode = unknown>(
  rawProtocol?: string,
  renderMap?: RenderMap,
  renderTree?: TreeRenderFunction | null,
): A2UIStore<VNode> {
  setRenderMap(renderMap ?? null);
  setTreeRenderer(renderTree ?? null);
  storeInstance = createA2UIStore();
  // 新会话：清空 outgoing userAction 队列
  outgoingActions = [];
  // 入场动画结束 → 回写 store 中 node.hasMounted；已为 true 则跳过（幂等）
  setMountNotifier((componentId) => {
    const current = storeInstance?.getState().hydrateNodeMap[componentId];
    if (!current || current.hasMounted) return;
    storeInstance!.getState().updateHydrateNode(componentId, {
      hasMounted: true,
    });
  });
  // userAction 出口：入 outgoing 队列并通知订阅者（playground 面板读取）
  setActionSink((action) => {
    outgoingActions = [...outgoingActions, action];
    outgoingListeners.forEach((listener) => listener());
  });
  // 数据模型桥：parse 时 dataModelUpdate 首先写入中心 store，
  // 渲染期全部消费也从 store 读取——store 是数据模型唯一数据源。
  setDataModelBridge({
    ensureSurface: (surfaceId) => {
      const state = storeInstance!.getState();
      if (!state.surfaceMap[surfaceId]) {
        state.addSurface({
          id: surfaceId,
          beginRender: false,
          rootNode: null,
        });
      }
    },
    getDataModel: (surfaceId) =>
      storeInstance?.getState().surfaceMap[surfaceId]?.dataModel,
    applyDataModelUpdate: (surfaceId, path, contents) => {
      const state = storeInstance!.getState();
      let surface: Surface = state.surfaceMap[surfaceId];
      if (!surface) {
        surface = { id: surfaceId, beginRender: false, rootNode: null };
      }
      // 纯逻辑替换 / 深写，结果回写 surface.dataModel；addSurface 替换该条目并通知
      applyDataModelUpdate(surface, path, contents);
      state.addSurface(surface);
    },
    commitLocalWrite: (surfaceId, path, value) => {
      const state = storeInstance!.getState();
      let surface: Surface = state.surfaceMap[surfaceId];
      if (!surface) {
        surface = { id: surfaceId, beginRender: false, rootNode: null };
      }
      commitLocalWrite(surface, path, value);
      state.addSurface(surface);
    },
  });
  // 本地写 cycle 后 mirror 快照进 store（rawProtocol 不变）
  setLocalChangeNotifier((result) => {
    storeInstance?.setState({
      surfaceMap: Object.fromEntries(
        result.surfaces.map((surface) => [surface.id, surface]),
      ),
      hydrateNodeMap: Object.fromEntries(
        result.hydrateNodes.map((node) => [node.componentId, node]),
      ),
      errorMap: Object.fromEntries(
        result.errors.map((error, index) => [`a2ui-error-${index}`, error]),
      ),
    });
  });
  if (rawProtocol) {
    storeInstance.getState().setRawProtocol(rawProtocol);
  }
  return storeInstance as A2UIStore<VNode>;
}

/** 兼容别名，等价于 init */
export const initStore = init;
