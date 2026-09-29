import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button, Empty, Modal, Tag } from "antd";
import {
  getA2UIStore,
  type A2UIStoreState,
  type A2UIError,
  type ComponentTree,
  ErrorType,
} from "@a2ui/core";

/**
 * 懒获取 init() 创建的全局 store。
 * 不在模块顶层获取，避免早于 main.tsx 中的 init() 而拿到旧实例。
 */
let store: ReturnType<typeof getA2UIStore> | null = null;
function getStore() {
  if (!store) store = getA2UIStore();
  return store;
}

/** 从 store 状态中提取可展示的数据字段（去掉 action 方法） */
function pickData(state: A2UIStoreState) {
  const { rawProtocol, surfaceMap, hydrateNodeMap, errorMap } = state;
  return { rawProtocol, surfaceMap, hydrateNodeMap, errorMap };
}

// 基于 state 引用缓存快照，保证 useSyncExternalStore 拿到稳定引用
let cachedRawState: A2UIStoreState | null = null;
let cachedSnapshot: ReturnType<typeof pickData> | null = null;
function getSnapshot() {
  const current = getStore().getState();
  if (current !== cachedRawState) {
    cachedRawState = current;
    cachedSnapshot = pickData(current);
  }
  return cachedSnapshot!;
}

/** 错误类型 -> Tag 颜色 */
const ERROR_TAG_COLOR: Record<ErrorType, string> = {
  [ErrorType.PARSE_ERROR]: "orange",
  [ErrorType.COMPONENT_NOT_REGISTERED]: "red",
};

/** 单条错误展示 */
function ErrorItem({ errorId, error }: { errorId: string; error: A2UIError }) {
  return (
    <div
      data-testid="error-item"
      style={{
        padding: "12px 0",
        borderBottom: "1px solid #f0f0f0",
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <Tag color={ERROR_TAG_COLOR[error.type] ?? "default"}>
          {error.type}
        </Tag>
        <span style={{ color: "#999", fontSize: 12 }}>{errorId}</span>
      </div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {error.content}
      </div>
    </div>
  );
}

/**
 * 渲染预览
 *
 * 通过 react（ReactDOM）的 createRoot.render 将组件根节点的
 * _vnode 独立渲染到容器中，与外层应用的 React 树分离。
 */
function RenderPreview({ tree }: { tree: ComponentTree }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<Root | null>(null);
  const pendingUnmountRef = useRef(false);

  // 内容更新：复用同一个独立 root（兼容 StrictMode 的 effect 重放）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    pendingUnmountRef.current = false;
    if (!rootRef.current) rootRef.current = createRoot(container);
    rootRef.current.render((tree.root?.node._vnode ?? null) as never);
  }, [tree]);

  // 仅在真实卸载时经微任务卸载 root；StrictMode 假卸载会被下一次 setup 取消
  useEffect(() => {
    return () => {
      const root = rootRef.current;
      if (!root) return;
      pendingUnmountRef.current = true;
      queueMicrotask(() => {
        if (!pendingUnmountRef.current) return;
        root.unmount();
        rootRef.current = null;
      });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="render-preview"
      style={{
        padding: 16,
        border: "1px solid #ddd",
        borderRadius: 8,
      }}
    />
  );
}

function App({ trees = [] }: { trees?: ComponentTree[] }) {
  const state = useSyncExternalStore(
    (onChange) => getStore().subscribe(onChange),
    getSnapshot
  );
  const [storeOpen, setStoreOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);

  const errorEntries = Object.entries(state.errorMap);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>A2UI Playground</h1>
      <Button
        type="primary"
        data-testid="show-store"
        onClick={() => setStoreOpen(true)}
      >
        查看 store
      </Button>
      <Button
        data-testid="show-errors"
        onClick={() => setErrorOpen(true)}
        style={{ marginLeft: 12 }}
      >
        查看错误（{errorEntries.length}）
      </Button>

      <h2>渲染预览（react.render）</h2>
      {trees.length === 0 && <p>暂无可渲染的组件</p>}
      {trees.map((tree) => (
        <RenderPreview key={tree.surfaceId} tree={tree} />
      ))}

      <Modal
        title="store 内容"
        open={storeOpen}
        onOk={() => setStoreOpen(false)}
        onCancel={() => setStoreOpen(false)}
        width={720}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
      >
        <pre
          data-testid="store-state"
          style={{
            maxHeight: "60vh",
            overflow: "auto",
            padding: 16,
            background: "#f5f5f5",
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
        >
          {JSON.stringify(state, null, 2)}
        </pre>
      </Modal>

      <Modal
        title="错误信息"
        open={errorOpen}
        onOk={() => setErrorOpen(false)}
        onCancel={() => setErrorOpen(false)}
        width={640}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
      >
        <div data-testid="error-list" style={{ maxHeight: "60vh", overflow: "auto" }}>
          {errorEntries.length === 0 ? (
            <Empty description="暂无错误" data-testid="error-empty" />
          ) : (
            errorEntries.map(([errorId, error]) => (
              <ErrorItem key={errorId} errorId={errorId} error={error} />
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}

export default App;
