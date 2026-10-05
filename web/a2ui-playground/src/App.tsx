import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button, Empty, Modal, Space, Statistic, Tag } from "antd";
import {
  clearOutgoingActions,
  createJsonStreamBuffer,
  createParser,
  getA2UIStore,
  getOutgoingActions,
  subscribeOutgoingActions,
  setTreeRenderer,
  type A2UIStoreState,
  type A2UIError,
  ErrorType,
  type ParseResult,
  type TreeRenderFunction,
  type UserAction,
} from "@a2ui/core";
import {
  fetchNonSSE,
  loadMock,
  resetForStreaming,
  type MockEntry,
} from "./main";

/** 流式模拟：每次推送的字符长度 */
const STREAM_CHUNK_SIZE = 50;
/** 流式模拟：分片推送间隔（ms），即每 50ms 输出 50 字符 */
const STREAM_CHUNK_INTERVAL_MS = 50;

/**
 * 流式循环令牌：每次 startStream 递增，旧循环回调发现自己令牌失效即 bail，
 * 防止任何残留定时器与新循环竞争（向同一 store 交叉写入）。
 */
let activeLoopId = 0;
function startStreamCounter(): number {
  activeLoopId += 1;
  return activeLoopId;
}
function isActiveLoop(id: number): boolean {
  return id === activeLoopId;
}
function invalidateLoops(): void {
  activeLoopId += 1;
}

/**
 * 懒获取当前 init() 创建的全局 store。
 * 切换 mock 时 loadMock 会 init 出全新 store 单例，需置空缓存以重新获取。
 */
let store: ReturnType<typeof getA2UIStore> | null = null;
function getStore() {
  if (!store) store = getA2UIStore();
  return store;
}

/** 切换 mock 后使缓存的 store / 快照失效，强制重新读取新 store */
function resetStoreCache() {
  store = null;
  cachedRawState = null;
  cachedSnapshot = null;
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
        <Tag color={ERROR_TAG_COLOR[error.type] ?? "default"}>{error.type}</Tag>
        <span style={{ color: "#999", fontSize: 12 }}>{errorId}</span>
      </div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {error.content}
      </div>
    </div>
  );
}

interface AppProps {
  catalog: MockEntry[];
  initialMockId: string;
}

function App({ catalog, initialMockId }: AppProps) {
  /** 渲染预览容器（SDK 通过 init 注入的渲染函数向其独立 root 渲染） */
  const previewHostRef = useRef<HTMLDivElement>(null);
  /** 当前注入 SDK 的组件树渲染函数（切换 mock / 流式重置时复用） */
  const renderTreeRef = useRef<TreeRenderFunction | null>(null);

  const [activeMockId, setActiveMockId] = useState(initialMockId);

  // 订阅当前 store；每次渲染的内联函数都是新闭包，切换后经 getStore() 读到新 store
  const state = useSyncExternalStore(
    (onChange) => getStore().subscribe(onChange),
    getSnapshot,
  );
  const [storeOpen, setStoreOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);

  // outgoing userAction 队列（init 时随新会话清空）
  const outgoingActions = useSyncExternalStore(
    subscribeOutgoingActions,
    getOutgoingActions,
  ) as readonly UserAction[];

  // ---- stream 模拟状态 ----
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamProgress, setStreamProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // ---- 非 SSE 接口调用状态 ----
  const [nonSSELoading, setNonSSELoading] = useState(false);
  const [nonSSEStatus, setNonSSEStatus] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  /** 卸载时确保定时器被清理 */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /** 独立 React root：ref 持久，StrictMode 假卸载后复用，避免同容器二次 createRoot */
  const independentRootRef = useRef<Root | null>(null);
  const pendingUnmountRef = useRef(false);

  /**
   * 挂载时建立独立 React root 与组件树渲染函数，
   * 经 loadMock → init 注入 SDK；此后每次 parse 完成 treebuild，
   * SDK 内部自动调用渲染函数，组件树无需外层 App 持有或透传。
   */
  useEffect(() => {
    const container = previewHostRef.current;
    if (!container) return;
    pendingUnmountRef.current = false;
    if (!independentRootRef.current) {
      independentRootRef.current = createRoot(container);
    }
    const independentRoot = independentRootRef.current;
    const renderTree: TreeRenderFunction = (tree) => {
      independentRoot.render((tree.root?.node._vnode ?? null) as never);
    };
    renderTreeRef.current = renderTree;

    loadMock(initialMockId, renderTree);
    resetStoreCache();

    return () => {
      renderTreeRef.current = null;
      setTreeRenderer(null);
      // 真实卸载经微任务卸载 root；StrictMode 假卸载会被下一次 setup 取消，
      // 从而避免在同一容器上第二次 createRoot（React 不支持，会导致空白）
      pendingUnmountRef.current = true;
      const root = independentRootRef.current;
      queueMicrotask(() => {
        if (!pendingUnmountRef.current) return;
        root?.unmount();
        independentRootRef.current = null;
      });
    };
    // 仅在挂载时建立一次；后续切换 mock 复用同一 root
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStreamTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  /**
   * 将流式解析的当前快照全量同步进 zustand store。
   * 渲染本身不在这里触发——parser 每次 treebuild 后已由 SDK 自动调用
   * init 注入的渲染函数；此处仅同步数据供 store / 错误面板查看。
   */
  const applyStreamResult = (result: ParseResult, pushedRaw: string) => {
    getA2UIStore().setState({
      rawProtocol: pushedRaw,
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
  };

  /**
   * 开始流式模拟：
   * 重置为空 store（复用已注入的渲染函数）→ 创建有状态 parser → 定时逐条推送；
   * 每条消息 treebuild 后由 SDK 内部自动渲染，此处仅同步 store 供面板查看。
   */
  const startStream = () => {
    const entry = catalog.find((item) => item.id === activeMockId);
    if (!entry) return;
    // 整份协议作为连续字符流，按 STREAM_CHUNK_SIZE 切分
    const fullText = entry.messages
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += STREAM_CHUNK_SIZE) {
      chunks.push(fullText.slice(i, i + STREAM_CHUNK_SIZE));
    }

    // 使任何旧循环失效（防御并发循环：旧定时器的回调将直接 bail）
    stopStreamTimer();
    const loopId = startStreamCounter();
    resetForStreaming(renderTreeRef.current);
    resetStoreCache();
    const parser = createParser();
    // JSON stream 缓冲区：分片可能切断任意 JSON，成帧后逐条送 parser
    const jsonBuffer = createJsonStreamBuffer();

    let index = 0;
    let consumedRaw = "";
    setStreamProgress({ current: 0, total: chunks.length });
    setIsStreaming(true);

    const pushOnce = () => {
      if (!isActiveLoop(loopId)) return; // 已被更新的循环取代
      // 分片进缓冲区：取出已完整的 JSONL（surfaceUpdate 已按 component 拆分）
      const readyLines = jsonBuffer.push(chunks[index]);
      consumedRaw += chunks[index];
      index += 1;
      // 同一分片可能成帧多条消息，逐条送 parser，以最后快照同步 store
      let result = parser.getResult();
      for (const line of readyLines) result = parser.parse(line);
      applyStreamResult(result, consumedRaw);
      setStreamProgress({ current: index, total: chunks.length });

      if (index >= chunks.length) {
        stopStreamTimer();
        setIsStreaming(false);
      }
    };

    pushOnce();
    timerRef.current = setInterval(pushOnce, STREAM_CHUNK_INTERVAL_MS);
  };

  /** 手动停止流式推送（保留已推送部分） */
  const stopStream = () => {
    invalidateLoops();
    stopStreamTimer();
    setIsStreaming(false);
  };

  /** 点击按钮切换 mock：若正在流式推送则先停止；渲染由 SDK 自动驱动 */
  const handleSelectMock = (id: string) => {
    if (id === activeMockId) return;
    invalidateLoops();
    stopStreamTimer();
    setIsStreaming(false);
    setStreamProgress(null);
    loadMock(id, renderTreeRef.current);
    resetStoreCache();
    setActiveMockId(id);
  };

  /**
   * 调用 a2ui-server 非 SSE 接口（POST /?stream=false）：
   * 停止任何流式推送 → 请求一次性 JSON 响应 → 解出 A2UI 消息重建 parser 渲染。
   */
  const handleFetchNonSSE = async () => {
    invalidateLoops();
    stopStreamTimer();
    setIsStreaming(false);
    setStreamProgress(null);
    setNonSSELoading(true);
    setNonSSEStatus(null);

    try {
      const result = await fetchNonSSE(
        "Request from playground: build UI (non-SSE)",
        renderTreeRef.current,
      );
      resetStoreCache();
      setActiveMockId("server-non-sse");
      setNonSSEStatus({
        ok: true,
        text: `成功 · ${result.messageCount} 条 A2UI 消息 · thread ${result.threadId}`,
      });
    } catch (error) {
      setNonSSEStatus({
        ok: false,
        text: `失败：${error instanceof Error ? error.message : String(error)}（请确认 a2ui-server 已在 8787 端口启动）`,
      });
    } finally {
      setNonSSELoading(false);
    }
  };

  const errorEntries = Object.entries(state.errorMap);

  // 当前渲染组件总数，及按组件类型（取自协议）的分项计数
  const hydrateEntries = Object.entries(state.hydrateNodeMap);
  const typeCount: Record<string, number> = {};
  for (const [id, node] of hydrateEntries) {
    let type = "unknown";
    try {
      const components = JSON.parse(node.protocol).surfaceUpdate
        .components as Array<{
        id: string;
        component: Record<string, unknown>;
      }>;
      const matched = components.find((item) => item.id === id);
      if (matched) type = Object.keys(matched.component)[0];
    } catch {
      /* 协议无法解析时计入 unknown */
    }
    typeCount[type] = (typeCount[type] ?? 0) + 1;
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>A2UI Playground</h1>

      <h2>选择 mock 数据</h2>
      <Space wrap data-testid="mock-switcher">
        {catalog.map((entry) => (
          <Button
            key={entry.id}
            data-testid={`mock-button-${entry.id}`}
            type={entry.id === activeMockId ? "primary" : "default"}
            onClick={() => handleSelectMock(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </Space>

      <div data-testid="stream-controls" style={{ marginTop: 16 }}>
        <Space>
          <Button
            data-testid="start-stream"
            type="primary"
            ghost
            disabled={isStreaming}
            onClick={startStream}
          >
            ▶ 流式分片推送（50字符/50ms）
          </Button>
          {isStreaming && (
            <Button data-testid="stop-stream" danger onClick={stopStream}>
              ■ 停止
            </Button>
          )}
          {streamProgress && (
            <Tag
              data-testid="stream-progress"
              color={isStreaming ? "processing" : "success"}
            >
              已推送 {streamProgress.current} / {streamProgress.total} 片
            </Tag>
          )}
        </Space>
      </div>

      <div data-testid="server-controls" style={{ marginTop: 16 }}>
        <Space>
          <Button
            data-testid="fetch-non-sse"
            onClick={handleFetchNonSSE}
            loading={nonSSELoading}
          >
            调用非 SSE 接口（POST /?stream=false）
          </Button>
          {nonSSEStatus && (
            <Tag
              data-testid="non-sse-status"
              color={nonSSEStatus.ok ? "success" : "error"}
            >
              {nonSSEStatus.text}
            </Tag>
          )}
        </Space>
      </div>

      <div style={{ marginTop: 24 }}>
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
        <Button
          data-testid="show-useractions"
          onClick={() => setActionOpen(true)}
          style={{ marginLeft: 12 }}
        >
          查看 userAction（{outgoingActions.length}）
        </Button>
      </div>

      <h2 style={{ marginTop: 24 }}>
        渲染预览（SDK 内部 treebuild 后驱动）：{activeMockId}
      </h2>
      <div
        ref={previewHostRef}
        data-testid="render-preview"
        style={{
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
      />

      <Modal
        title="store 内容"
        open={storeOpen}
        onOk={() => setStoreOpen(false)}
        onCancel={() => setStoreOpen(false)}
        width={720}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
      >
        <div
          data-testid="store-summary"
          style={{
            marginBottom: 16,
            padding: 16,
            background: "#fafafa",
            border: "1px solid #eee",
            borderRadius: 8,
          }}
        >
          <Statistic
            title="当前渲染组件总数"
            value={hydrateEntries.length}
            data-testid="component-total"
          />
          <Space size={8} wrap style={{ marginTop: 8 }}>
            {Object.entries(typeCount).map(([type, count]) => (
              <Tag key={type} data-testid={`component-type-${type}`}>
                {type} × {count}
              </Tag>
            ))}
          </Space>
        </div>
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
        <div
          data-testid="error-list"
          style={{ maxHeight: "60vh", overflow: "auto" }}
        >
          {errorEntries.length === 0 ? (
            <Empty description="暂无错误" data-testid="error-empty" />
          ) : (
            errorEntries.map(([errorId, error]) => (
              <ErrorItem key={errorId} errorId={errorId} error={error} />
            ))
          )}
        </div>
      </Modal>

      <Modal
        title="outgoing userAction"
        open={actionOpen}
        onOk={() => setActionOpen(false)}
        onCancel={() => setActionOpen(false)}
        width={640}
        okText="关闭"
        footer={[
          <Button
            key="clear"
            danger
            data-testid="clear-useractions"
            disabled={outgoingActions.length === 0}
            onClick={() => clearOutgoingActions()}
          >
            清空
          </Button>,
          <Button
            key="close"
            type="primary"
            onClick={() => setActionOpen(false)}
          >
            关闭
          </Button>,
        ]}
      >
        <div
          data-testid="useraction-list"
          style={{ maxHeight: "60vh", overflow: "auto" }}
        >
          {outgoingActions.length === 0 ? (
            <Empty
              description="暂无 userAction"
              data-testid="useraction-empty"
            />
          ) : (
            outgoingActions.map((action, index) => (
              <pre
                key={index}
                data-testid="useraction-item"
                style={{
                  padding: 12,
                  background: "#f5f5f5",
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {JSON.stringify(action, null, 2)}
              </pre>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}

export default App;
