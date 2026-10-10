import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Tag,
} from "antd";
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
  loadMock,
  resetForStreaming,
  streamAgentRun,
  streamChatReply,
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

/** 对话消息（用户气泡 / 带序号的 Agent 完成消息） */
interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** Agent 消息的递增序号（消息左侧的数字徽标） */
  agentNumber?: number;
  /** 接口调用失败时以红色展示 */
  error?: boolean;
  /** "chat" = 纯模型对话回复（普通字体）；缺省 = A2UI agent 完成摘要（等宽字体） */
  kind?: "chat";
  /**
   * A2UI agent 调用阶段：
   *   generating = 模型生成中（RUN_STARTED，等待协议）
   *   rendering  = 协议渲染中（已开始收到 CUSTOM/a2ui，增量解析渲染）
   *   done       = 已完成（RUN_FINISHED）
   * 失败消息不携带 phase，按红色错误消息渲染。
   */
  phase?: "generating" | "rendering" | "done";
}

const smallGrayText: CSSProperties = {
  margin: "6px 0 0",
  fontSize: 12,
  lineHeight: 1.6,
  color: "#8c8c8c",
};

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
  const [jsonOpen, setJsonOpen] = useState(false);

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

  // ---- 对话状态 ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  /** 是否正在等待接口响应（发送键 loading、输入框禁用） */
  const [sending, setSending] = useState(false);
  /** 模型对话模式开关：开启后发送仅测试模型对话，不渲染 A2UI */
  const [chatMode, setChatMode] = useState(false);
  const agentCountRef = useRef(0);
  const messageListRef = useRef<HTMLDivElement>(null);

  /** 卸载时确保定时器被清理 */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 新消息后自动滚到底部
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

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
   * 开始本地模拟流：
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

  /** 场景下拉切换：若正在流式推送则先停止；渲染由 SDK 自动驱动 */
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
   * 发送对话消息：以用户文本调用 a2ui-server 的 SSE 流式接口（POST /）——
   * 先回显用户气泡并停止任何本地流式推送，同时立即插入一条带序号的
   * 「模型生成中」占位 Agent 消息；随后随事件流推进状态：
   *   模型生成中（RUN_STARTED）→ 协议渲染中（CUSTOM/a2ui 增量到达）
   *   → Agent 完成（RUN_FINISHED，含 threadId / 协议条数摘要）；
   * RUN_ERROR 或网络失败则将该消息转为红色错误展示。
   */
  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setChatMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text },
    ]);

    // ---- 模型对话模式：仅测试模型，不触碰 parser / A2UI 预览 ----
    if (chatMode) {
      const replyId = crypto.randomUUID();
      setChatMessages((prev) => [
        ...prev,
        { id: replyId, role: "agent", kind: "chat", text: "" },
      ]);
      setSending(true);
      try {
        await streamChatReply(text, (delta) =>
          setChatMessages((prev) =>
            prev.map((message) =>
              message.id === replyId
                ? { ...message, text: message.text + delta }
                : message,
            ),
          ),
        );
      } catch (error) {
        setChatMessages((prev) =>
          prev.map((message) =>
            message.id === replyId
              ? {
                  ...message,
                  error: true,
                  text: `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
                }
              : message,
          ),
        );
      } finally {
        setSending(false);
      }
      return;
    }

    invalidateLoops();
    stopStreamTimer();
    setIsStreaming(false);
    setStreamProgress(null);
    setSending(true);

    // 序号在发起时即分配，占位消息从「模型生成中」开始推进
    agentCountRef.current += 1;
    const agentNumber = agentCountRef.current;
    const agentMessageId = crypto.randomUUID();
    setChatMessages((prev) => [
      ...prev,
      {
        id: agentMessageId,
        role: "agent",
        agentNumber,
        phase: "generating",
        text: "模型生成中…",
      },
    ]);

    const patchAgent = (patch: Partial<ChatMessage>) => {
      setChatMessages((prev) =>
        prev.map((message) =>
          message.id === agentMessageId ? { ...message, ...patch } : message,
        ),
      );
    };

    try {
      const result = await streamAgentRun(text, renderTreeRef.current, {
        onStart: () => patchAgent({ phase: "generating", text: "模型生成中…" }),
        onProtocol: ({ received }) =>
          patchAgent({
            phase: "rendering",
            text: `协议渲染中…（已接收 ${received} 条协议消息）`,
          }),
      });
      resetStoreCache();
      const summary = JSON.stringify({
        threadId: result.threadId,
        a2uiMessageCount: result.messageCount,
      });
      patchAgent({
        phase: "done",
        text: `Agent 完成: (${summary})`,
      });
    } catch (error) {
      patchAgent({
        phase: undefined,
        error: true,
        text: `接口调用失败：${error instanceof Error ? error.message : String(error)}（请确认 a2ui-server 已在 8787 端口启动）`,
      });
    } finally {
      setSending(false);
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
    <div
      style={{
        height: "100vh",
        display: "flex",
        background: "#fff",
        fontFamily:
          '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* ============ 左栏：Agent 对话 ============ */}
      <aside
        data-testid="agent-panel"
        style={{
          width: 300,
          flexShrink: 0,
          borderRight: "1px solid #e8e8e8",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ padding: "20px 20px 12px" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Agent 对话
          </h2>
          <p style={smallGrayText}>
            右侧为 A2UI 预览；服务端每整段 JSONL 协议切片为 CUSTOM / a2ui.jsonl
            chunk 流式推送。
          </p>

          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Switch
              size="small"
              data-testid="chat-mode-switch"
              checked={chatMode}
              onChange={setChatMode}
            />
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              模型对话模式（仅测模型）
            </span>
          </div>
          <p style={smallGrayText}>
            开启后，下方发送将直接调用模型对话接口（POST
            /chat），流式展示模型回复，不渲染 A2UI。
          </p>

          <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700 }}>
            本地模拟流 · 场景
          </div>
          <p style={smallGrayText}>
            通过 /api/agent 时服务端每次随机选合适场景 mock（不含
            Text/Image/Icon/Button 等用于演示）；「本地模拟流」使用下方选择。
          </p>

          <div data-testid="mock-switcher" style={{ marginTop: 10 }}>
            <Select
              data-testid="mock-scenario-select"
              style={{ width: "100%" }}
              value={activeMockId}
              options={catalog.map((entry) => ({
                value: entry.id,
                label: entry.label,
              }))}
              onChange={handleSelectMock}
            />
          </div>

          {/* 次级能力：非 SSE 接口 + userAction 查看 */}
          <div
            style={{
              width: "100%",
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <Button
              block
              size="small"
              type="text"
              data-testid="show-useractions"
              onClick={() => setActionOpen(true)}
            >
              查看 userAction（{outgoingActions.length}）
            </Button>
          </div>
        </div>

        {/* 消息列表 */}
        <div
          ref={messageListRef}
          data-testid="chat-messages"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "4px 16px",
            minHeight: 0,
          }}
        >
          {chatMessages.map((message) =>
            message.role === "user" ? (
              <div
                key={message.id}
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  padding: "8px 0",
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    background: "#f5f5f5",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: "#262626",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {message.text}
                </div>
              </div>
            ) : (
              <div
                key={message.id}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "10px 0",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: message.error
                      ? "#fff2f0"
                      : message.kind === "chat"
                        ? "#f6ffed"
                        : "#f0f5ff",
                    color: message.error
                      ? "#ff4d4f"
                      : message.kind === "chat"
                        ? "#52c41a"
                        : "#1677ff",
                    fontSize: 12,
                    fontWeight: 600,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {message.kind === "chat" ? (
                    "AI"
                  ) : message.phase === "generating" ||
                    message.phase === "rendering" ? (
                    <Spin
                      size="small"
                      data-testid={`agent-spinner-${message.phase}`}
                    />
                  ) : (
                    message.agentNumber
                  )}
                </div>
                <div
                  data-testid={
                    message.phase === "generating"
                      ? "agent-phase-generating"
                      : message.phase === "rendering"
                        ? "agent-phase-rendering"
                        : undefined
                  }
                  style={{
                    fontFamily:
                      message.kind === "chat" ? "inherit" : "monospace",
                    fontSize: message.kind === "chat" ? 13 : 12,
                    lineHeight: 1.6,
                    color: message.error
                      ? "#ff4d4f"
                      : message.kind === "chat"
                        ? "#262626"
                        : "#595959",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {message.kind === "chat" && !message.text && !message.error
                    ? "…"
                    : message.text}
                </div>
              </div>
            ),
          )}
        </div>

        {/* 输入区 */}
        <div
          style={{
            borderTop: "1px solid #e8e8e8",
            padding: 12,
          }}
        >
          <Input.TextArea
            data-testid="chat-input"
            value={draft}
            disabled={sending}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="输入消息后按发送调用接口（Enter 发送，Shift+Enter 换行）"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <div
            style={{
              marginTop: 8,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Button
              type="primary"
              data-testid="chat-send"
              loading={sending}
              onClick={sendMessage}
            >
              发送
            </Button>
          </div>
        </div>
      </aside>

      {/* ============ 右栏：A2UI Playground ============ */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <header
          style={{
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            A2UI Playground
          </h1>
          <Space size={8}>
            <Button
              type="primary"
              data-testid="show-store"
              onClick={() => setStoreOpen(true)}
            >
              View Store
            </Button>
            <Button
              danger
              data-testid="show-errors"
              onClick={() => setErrorOpen(true)}
            >
              View Errors
              {errorEntries.length > 0 ? ` (${errorEntries.length})` : ""}
            </Button>
            <Button
              data-testid="show-a2ui-json"
              onClick={() => setJsonOpen(true)}
            >
              View A2UI JSON
            </Button>
            {isStreaming ? (
              <>
                <Button data-testid="stop-stream" danger onClick={stopStream}>
                  停止
                </Button>
                {streamProgress && (
                  <Tag data-testid="stream-progress" color="processing">
                    {streamProgress.current} / {streamProgress.total}
                  </Tag>
                )}
              </>
            ) : (
              <Button data-testid="start-stream" onClick={startStream}>
                本地模拟流
              </Button>
            )}
          </Space>
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: "0 24px 24px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              margin: "0 0 12px",
            }}
          >
            预览区
          </div>
          <div
            ref={previewHostRef}
            data-testid="render-preview"
            style={{
              flex: 1,
              minHeight: 0,
              padding: 20,
              border: "1px solid #e8e8e8",
              borderRadius: 8,
              overflow: "auto",
            }}
          />
        </div>
      </main>

      {/* ============ 弹窗 ============ */}
      <Modal
        title="Store"
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
        title="A2UI JSON"
        open={jsonOpen}
        onOk={() => setJsonOpen(false)}
        onCancel={() => setJsonOpen(false)}
        width={760}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
      >
        <pre
          data-testid="a2ui-json-content"
          style={{
            maxHeight: "60vh",
            overflow: "auto",
            padding: 16,
            background: "#f5f5f5",
            border: "1px solid #ddd",
            borderRadius: 8,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {state.rawProtocol || "// (empty)"}
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
