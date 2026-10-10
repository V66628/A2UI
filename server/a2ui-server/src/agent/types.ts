/**
 * Agent 抽象层
 *
 * Agent 只负责产出 A2UI server→client 协议消息流（每条为单行 JSON 字符串），
 * 不感知传输层（SSE）与标准交互协议（AG-UI）——后者由外层统一封装。
 */

/** 一次 agent 运行的图片输入（url 为远端 URL 或 data URL） */
export interface AgentImageInput {
  url: string;
}

/** 一次 agent 运行的输入（由 HTTP 接口解析用户请求得到） */
export interface AgentRunInput {
  /** 用户的文本输入 */
  input: string;
  /** 用户附带的参考图片（截图/草图/设计稿，多模态）；可选 */
  images?: AgentImageInput[];
  /** 会话 id（可由客户端传入，缺省由服务端生成） */
  threadId: string;
  /** 本次运行 id */
  runId: string;
}

/**
 * A2UI Agent：产出 A2UI 消息的异步可迭代流。
 * 实现方可为 MockAgent（本地 canned 协议）或未来的 OpenAIAgent。
 */
export interface A2UIAgent {
  run(input: AgentRunInput): AsyncIterable<string>;
}
