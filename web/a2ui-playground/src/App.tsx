import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { PictureOutlined, CloseOutlined } from "@ant-design/icons";
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
  Tooltip,
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
  createAgentSession,
  loadMock,
  resetForStreaming,
  streamChatReply,
  type AgentImage,
  type AgentSession,
  type MockEntry,
} from "./main";
import { Welcome } from "./Welcome";
import { checkProtocol } from "./specCompliance";

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
  /** 用户消息附带的参考图片（data URL），多模态 */
  images?: AgentImage[];
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
  /**
   * A2UI 多轮会话：首轮发送时懒创建（重置 store、分配 threadId），
   * 后续发送复用，支持基于现有界面的连续微调；切换 mock 时丢弃。
   */
  const agentSessionRef = useRef<AgentSession | null>(null);
  const agentCountRef = useRef(0);
  const messageListRef = useRef<HTMLDivElement>(null);
  /** 待发送的参考图片（data URL），发送后清空 */
  const [pendingImages, setPendingImages] = useState<AgentImage[]>([]);
  /** 隐藏的图片选择 input */
  const fileInputRef = useRef<HTMLInputElement>(null);

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
   * 挂载时建立独立 React root 与组件树渲染函数并注入 SDK。
   * 初始不加载任何 mock：预览区为空状态，由 Welcome 欢迎页占位；
   * 用户发送对话 / 选择模拟流场景后才渲染具体协议。
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

    // 仅注入渲染函数，不预加载 mock 场景
    resetForStreaming(renderTree);
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
    // 丢弃旧会话：下次发送开启全新线程，不继承上一个 mock 的上下文
    agentSessionRef.current = null;
    loadMock(id, renderTreeRef.current);
    resetStoreCache();
    setActiveMockId(id);
  };

  /**
   * 发送对话消息：调用 a2ui-server 的 SSE 流式接口（POST /）——
   * 先回显用户气泡并停止任何本地流式推送，同时立即插入一条带序号的
   * 「模型生成中」占位 Agent 消息；随后随事件流推进状态：
   *   模型生成中（RUN_STARTED）→ 协议渲染中（CUSTOM/a2ui 增量到达）
   *   → Agent 完成（RUN_FINISHED，含 threadId / 累计协议条数摘要）；
   * RUN_ERROR 或网络失败则将该消息转为红色错误展示。
   * 同一 agentSession 内可连续发送微调指令（复用 threadId 与已渲染状态）。
   */
  const sendMessage = async () => {
    const text = draft.trim();
    // 允许仅发图片（文本为空时以占位说明作为 input）
    if ((!text && pendingImages.length === 0) || sending) return;
    const images = pendingImages;
    setDraft("");
    setPendingImages([]);
    setChatMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text,
        images: images.length > 0 ? images : undefined,
      },
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
      // 首轮懒创建会话（重置 + 分配 threadId）；微调轮复用同一
      // 会话与线程，预览区就地增量更新
      if (!agentSessionRef.current) {
        agentSessionRef.current = createAgentSession(renderTreeRef.current);
      }
      const result = await agentSessionRef.current.send(
        text,
        {
          onStart: () =>
            patchAgent({ phase: "generating", text: "模型生成中…" }),
          onProtocol: ({ received }) =>
            patchAgent({
              phase: "rendering",
              text: `协议渲染中…（已接收 ${received} 条协议消息）`,
            }),
        },
        images,
      );
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

  /**
   * 预览区「点击元素 → 引用 id」：找到事件起点最近的带 data-component-id
   * 的组件节点，将其 id 追加到对话草稿（以空格分隔，便于直接续写微调指令）。
   * 不拦截事件、不阻止默认行为：Button 仍触发 userAction，TextField 仍可聚焦，
   * 连续点击同一组件不会重复追加。
   */
  const handlePreviewClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const hit = (event.target as HTMLElement).closest(
      "[data-component-id]",
    ) as HTMLElement | null;
    const id = hit?.dataset.componentId;
    if (!id) return;
    setDraft((prev) => {
      const suffix = `${id} `;
      if (prev.endsWith(suffix)) return prev;
      return prev ? `${prev.replace(/\s+$/, "")} ${suffix}` : suffix;
    });
  };

  /** 把一组图片文件读取为 data URL 并加入待发送列表 */
  const addImageFiles = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    Promise.all(
      images.map(
        (file) =>
          new Promise<AgentImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ url: String(reader.result) });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((items) => setPendingImages((prev) => [...prev, ...items]))
      .catch(() => {
        /* 单个文件读取失败时忽略 */
      });
  };

  /** 通过文件选择器选图 */
  const handlePickImages = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // 允许重复选择同一文件：重置 input value
    event.target.value = "";
    addImageFiles(files);
  };

  /** 粘贴截图/图片：剪贴板中的图片直接加入待发送列表 */
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    // 模型对话模式不支持多模态；发送中也忽略
    if (chatMode || sending) return;
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length > 0) {
      // 阻止浏览器默认的粘贴行为（如把图片地址插入文本框）
      event.preventDefault();
      addImageFiles(files);
    }
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  /** 点击欢迎页示例：填入输入框并聚焦，用户确认后再发送 */
  const handlePickPrompt = (prompt: string) => {
    if (sending || chatMode) return;
    setDraft(prompt);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>(
          'textarea[data-testid="chat-input"]',
        )
        ?.focus();
    });
  };

  const errorEntries = Object.entries(state.errorMap);

  /** A2UI v0.8 标准合规报告（弹窗打开时按当前原始 JSONL 计算） */
  const complianceReport = useMemo(
    () =>
      jsonOpen && state.rawProtocol ? checkProtocol(state.rawProtocol) : null,
    [jsonOpen, state.rawProtocol],
  );

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
        onPaste={handlePaste}
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
                  {message.images && message.images.length > 0 && (
                    <div
                      data-testid="chat-message-images"
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginBottom: message.text ? 6 : 0,
                      }}
                    >
                      {message.images.map((image, index) => (
                        <img
                          key={index}
                          src={image.url}
                          alt={`参考图片 ${index + 1}`}
                          style={{
                            maxWidth: 160,
                            maxHeight: 160,
                            borderRadius: 6,
                            display: "block",
                            objectFit: "contain",
                          }}
                        />
                      ))}
                    </div>
                  )}
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
          {/* 待发送图片缩略图 */}
          {pendingImages.length > 0 && (
            <div
              data-testid="pending-images"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 8,
              }}
            >
              {pendingImages.map((image, index) => (
                <div
                  key={index}
                  style={{ position: "relative", width: 64, height: 64 }}
                >
                  <img
                    src={image.url}
                    alt={`待发送图片 ${index + 1}`}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: "cover",
                      borderRadius: 6,
                      border: "1px solid #d9d9d9",
                    }}
                  />
                  <button
                    type="button"
                    aria-label="移除图片"
                    disabled={sending}
                    onClick={() => removePendingImage(index)}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: "none",
                      background: "#ff4d4f",
                      color: "#fff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    <CloseOutlined style={{ fontSize: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Input.TextArea
            data-testid="chat-input"
            value={draft}
            disabled={sending}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="输入界面需求或微调指令，可点「图片」或直接 Ctrl+V 粘贴截图（Enter 发送，Shift+Enter 换行）"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handlePickImages}
          />
          <div
            style={{
              marginTop: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Tooltip
              title={
                chatMode
                  ? "图片多模态仅在 A2UI 生成模式下可用，请先关闭「模型对话模式」"
                  : "附带截图 / 草图 / 设计稿作为参考"
              }
            >
              <Button
                icon={<PictureOutlined />}
                disabled={sending || chatMode}
                data-testid="attach-image"
                onClick={() => fileInputRef.current?.click()}
              >
                图片
              </Button>
            </Tooltip>
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
            <span style={{ fontSize: 12, fontWeight: 400, color: "#8c8c8c" }}>
              （点击组件可将其 ID 加入对话输入框）
            </span>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              position: "relative",
              border: "1px solid #e8e8e8",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <div
              ref={previewHostRef}
              data-testid="render-preview"
              onClick={handlePreviewClick}
              style={{
                position: "absolute",
                inset: 0,
                overflow: "auto",
                padding: 20,
              }}
            />
            {/* 空状态欢迎页：尚未生成任何协议时展示；发送中不闪回 */}
            {hydrateEntries.length === 0 && !sending && !isStreaming && (
              <Welcome onPickPrompt={handlePickPrompt} />
            )}
          </div>
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
        {state.rawProtocol ? (
          <div data-testid="a2ui-json-content">
            {/* v0.8 标准合规摘要 */}
            {complianceReport && (
              <div
                data-testid="compliance-summary"
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 12,
                  fontSize: 12,
                }}
              >
                <span style={{ color: "#8c8c8c" }}>v0.8 合规校验：</span>
                <Tag color="green" data-testid="compliance-valid">
                  合规 {complianceReport.totals.valid}
                </Tag>
                <Tag color="orange" data-testid="compliance-extension">
                  扩展 {complianceReport.totals.extension}
                </Tag>
                <Tag
                  color={
                    complianceReport.totals.invalid > 0 ? "red" : "default"
                  }
                  data-testid="compliance-invalid"
                >
                  违规 {complianceReport.totals.invalid}
                </Tag>
                <span style={{ color: "#bfbfbf" }}>
                  共 {complianceReport.totals.total} 条消息
                </span>
                <span style={{ color: "#bfbfbf" }}>
                  （「扩展」= 项目方言、v0.8 标准外但渲染器支持，如组件级
                  styles）
                </span>
              </div>
            )}
            <div
              style={{
                maxHeight: "60vh",
                overflow: "auto",
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fafafa",
              }}
            >
              {complianceReport?.lines
                .filter((line) => line.raw.trim() !== "")
                .map((line) => {
                  const borderColor =
                    line.status === "invalid"
                      ? "#ff4d4f"
                      : line.status === "extension"
                        ? "#faad14"
                        : "#d9f7be";
                  const dotColor =
                    line.status === "invalid"
                      ? "#ff4d4f"
                      : line.status === "extension"
                        ? "#faad14"
                        : "#52c41a";
                  return (
                    <div
                      key={line.lineNo}
                      data-testid={`compliance-line-${line.lineNo}`}
                      style={{
                        borderLeft: `3px solid ${borderColor}`,
                        padding: "8px 12px",
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: dotColor,
                            display: "inline-block",
                            flex: "none",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: "#8c8c8c",
                            fontFamily: "monospace",
                          }}
                        >
                          #{line.lineNo}
                        </span>
                        {line.action && (
                          <Tag
                            style={{
                              margin: 0,
                              fontSize: 11,
                              lineHeight: "18px",
                            }}
                          >
                            {line.action}
                          </Tag>
                        )}
                        {line.issues.map((issue, index) => (
                          <Tag
                            key={index}
                            color={issue.level === "error" ? "red" : "orange"}
                            style={{
                              margin: 0,
                              fontSize: 11,
                              lineHeight: "18px",
                            }}
                          >
                            {issue.level === "error" ? "违规" : "扩展"}
                          </Tag>
                        ))}
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 12,
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "monospace",
                          color: "#262626",
                        }}
                      >
                        {line.raw}
                      </pre>
                      {line.issues.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {line.issues.map((issue, index) => (
                            <div
                              key={index}
                              style={{
                                fontSize: 11,
                                lineHeight: 1.6,
                                color:
                                  issue.level === "error"
                                    ? "#cf1322"
                                    : "#ad6800",
                              }}
                            >
                              {issue.level === "error" ? "✕" : "△"} {issue.path}
                              ：{issue.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ) : (
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
            {"// (empty)"}
          </pre>
        )}
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
