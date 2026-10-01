import { createStore, type StoreApi } from "zustand/vanilla";
import {
  setMountNotifier,
  setRenderMap,
  setTreeRenderer,
  type TreeRenderFunction,
} from "../parser/render-registry.js";
import type { RenderMap } from "../parser/types.js";
import type { A2UIStoreState } from "./types.js";

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
  // 入场动画结束 → 回写 store 中 node.hasMounted；已为 true 则跳过（幂等）
  setMountNotifier((componentId) => {
    const current = storeInstance?.getState().hydrateNodeMap[componentId];
    if (!current || current.hasMounted) return;
    storeInstance!.getState().updateHydrateNode(componentId, {
      hasMounted: true,
    });
  });
  if (rawProtocol) {
    storeInstance.getState().setRawProtocol(rawProtocol);
  }
  return storeInstance as A2UIStore<VNode>;
}

/** 兼容别名，等价于 init */
export const initStore = init;
