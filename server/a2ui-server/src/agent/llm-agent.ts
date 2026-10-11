import { llmConfig } from "../config";
import {
  streamCompletion,
  type ChatMessage,
  type CompletionStreamer,
  type ContentPart,
  type RawToolCall,
  type ToolDefinition,
} from "../llm/completion";
import { toOpenAITool, type AgentTool } from "../tools/agent-tool";
import { searchIconsTool } from "../tools/search-icons-tool";
import { buildSystemPrompt } from "./prompt";
import type { AgentRunInput, A2UIAgent } from "./types";

export interface LLMAgentOptions {
  /** 覆盖文本模型 */
  model?: string;
  /** 覆盖视觉模型（附带图片时使用） */
  visionModel?: string;
  /** 注入 completion 流式函数（测试用 fake；缺省走真实 OpenAI 兼容端点） */
  streamer?: CompletionStreamer;
  /** 可用工具（缺省仅 search_antd_icons；传 [] 关闭工具） */
  tools?: AgentTool[];
  /** 每次模型发起工具调用时回调（监控/评测用） */
  onToolCall?: (toolName: string) => void;
}

/** 最终输出不完整（未闭合对象 / 无合法消息 / 工具轮超限）时可安全重试 */
class IncompleteOutputError extends Error {}

/** 输出不完整时的最大尝试次数（含首次） */
const MAX_ATTEMPTS = 3;
/** 单次尝试中工具回路的最大轮数（防止模型反复调工具不收尾） */
const MAX_TOOL_ROUNDS = 5;

/**
 * LLM A2UI Agent（支持多轮微调，协议由客户端携带）：
 *   system（prompt 模板 + Renderer Catalog）
 *   user（多轮时文本中含「当前已渲染协议 + 微调指令」+ 可选图片 parts）
 * → 多模态模型流式输出：
 *     若模型发起 tool_call（如 search_antd_icons 查询可用图标），
 *     在进程内执行工具并把结果回灌，进入下一轮；
 *     最终一轮的正文按 JSONL 切分、校验后逐条产出 A2UI 消息。
 *     首轮全量生成；后续轮次仅产出针对现有协议的最小增量，
 *     由客户端拼回原协议后渲染。server 不保存对话状态。
 *
 * 附带图片时自动切换视觉模型（VISION_MODEL，缺省 qwen3.5-omni-plus）。
 *
 * 非确定性容错：
 *   - 对象 pretty-print 到多个物理行 → 累积拼接；
 *   - 对象之间误输出字面量 "\n" → 自动拆分；
 *   - 最终正文不完整 → 追加纠错 system 消息后重试，最多 MAX_ATTEMPTS 次。
 */
export class LLMAgent implements A2UIAgent {
  private readonly model?: string;
  private readonly visionModel?: string;
  private readonly streamer: CompletionStreamer;
  private readonly tools: AgentTool[];
  private readonly toolDefs: ToolDefinition[];
  private readonly onToolCall?: (toolName: string) => void;

  constructor(options: LLMAgentOptions = {}) {
    this.model = options.model;
    this.visionModel = options.visionModel;
    this.streamer = options.streamer ?? streamCompletion;
    this.tools = options.tools ?? [searchIconsTool];
    this.toolDefs = this.tools.map(toOpenAITool);
    this.onToolCall = options.onToolCall;
  }

  async *run(input: AgentRunInput): AsyncGenerator<string> {
    const images = input.images ?? [];
    const currentProtocol = input.currentProtocol?.trim();
    const isFollowUp = !!currentProtocol;

    // 多轮微调：客户端把当前已渲染协议随请求带来，user 文本中
    // 提供「现有协议 + 微调指令」，模型只产出增量 JSONL；
    // 首轮：仅界面需求，全量生成
    const parts: ContentPart[] = [];
    if (isFollowUp) {
      parts.push({
        type: "text",
        text:
          "The A2UI protocol currently rendered on the client is:\n\n" +
          `${currentProtocol}\n\n` +
          "Apply the requested change to that protocol. Return ONLY the minimal incremental JSONL messages " +
          "(they will be appended to the protocol above by the client): do not restate or rebuild unchanged " +
          "components and keep existing ids stable. Do NOT resend a beginRendering or deleteSurface message; " +
          "the surface is already rendering. A component you redefine must be complete (partial objects are not allowed). " +
          "For example, to set a Button's vertical padding to 0, emit a single surfaceUpdate that redefines that " +
          "Button with the paddingVertical field: " +
          '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"<buttonId>","component":{"Button":{"child":"<childId>","primary":true,"paddingVertical":0}}}]}}. ' +
          "Requested change:",
      });
    }
    parts.push({ type: "text", text: input.input });
    for (const image of images) {
      parts.push({ type: "image_url", image_url: { url: image.url } });
    }

    const userMessage: ChatMessage = { role: "user", content: parts };

    const model =
      images.length > 0
        ? (this.visionModel ?? llmConfig.visionModel)
        : (this.model ?? llmConfig.model);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt() },
        userMessage,
      ];
      if (attempt > 1) {
        messages.push({
          // 用 system 而非 OpenAI 的 developer：阿里云等兼容端点
          // 不接受 developer（会 400）
          role: "system",
          content:
            `Your previous response (attempt ${attempt - 1}) was incomplete or was not valid JSONL. ` +
            "Regenerate the COMPLETE response for this turn: one JSON object per physical line " +
            "(a real newline, never the literal characters backslash-n), each object fully closed. " +
            "For a follow-up turn emit only the minimal changes and do not resend beginRendering; " +
            "for an initial turn beginRendering must be the last line. Do not explain.",
        });
      }

      try {
        yield* this.runWithTools(messages, model);
        return;
      } catch (error) {
        if (
          !(error instanceof IncompleteOutputError) ||
          attempt === MAX_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
  }

  /** 单次尝试：工具回路 + 最终 JSONL 提取 */
  private async *runWithTools(
    messages: ChatMessage[],
    model: string,
  ): AsyncGenerator<string> {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      // 流式消费一轮：正文与工具调用都在响应结束时才完整
      let contentText = "";
      const toolCalls: RawToolCall[] = [];
      for await (const event of this.streamer(messages, {
        model,
        tools: this.toolDefs,
      })) {
        if (event.type === "delta") contentText += event.text;
        else if (event.type === "toolCall") toolCalls.push(event.toolCall);
      }

      if (toolCalls.length === 0) {
        // 无工具调用 → 本轮正文即最终答案，提取 JSONL 产出
        yield* extractJsonlMessages(contentText);
        return;
      }

      // 有工具调用：回灌 assistant(tool_calls) 与每个 tool 结果后继续
      messages.push({
        role: "assistant",
        content: contentText || null,
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        this.onToolCall?.(call.function.name);
        const result = await this.executeToolCall(call);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    throw new IncompleteOutputError(
      `model kept calling tools for ${MAX_TOOL_ROUNDS} rounds without producing a final answer`,
    );
  }

  /** 执行一次工具调用：任何异常（工具不存在/参数非法/执行失败）都编码为 JSON 字符串结果回灌 */
  private async executeToolCall(call: RawToolCall): Promise<string> {
    const tool = this.tools.find((item) => item.name === call.function.name);
    if (!tool) {
      return JSON.stringify({
        error: `unknown tool: ${call.function.name}`,
      });
    }

    let args: Record<string, unknown> = {};
    if (call.function.arguments.trim()) {
      try {
        const parsed: unknown = JSON.parse(call.function.arguments);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        return JSON.stringify({
          error: `tool arguments are not valid JSON: ${call.function.arguments.slice(0, 120)}`,
        });
      }
    }

    try {
      return await tool.execute(args);
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ============ 最终正文 → JSONL 消息提取 ============

/**
 * 从模型最终正文提取 0..N 条合法协议消息：
 *   - 逐物理行消费，空行/代码围栏/杂散文本跳过；
 *   - 对象内部换行（pretty-print）→ 累积拼接；
 *   - 对象之间被写成字面量反斜杠+n → 拆分。
 * 一条合法消息都没有（或末个对象未闭合）→ IncompleteOutputError。
 */
function extractJsonlMessages(rawText: string): Generator<string> {
  let buffer = rawText;
  let pending = "";
  let count = 0;

  function consumePhysicalLine(physical: string): string[] {
    const line = physical.trim();
    if (!line || line.startsWith("```")) return [];

    if (!isParseableJsonObject(line) && line.includes("\\n")) {
      const pieces = line.split(/(?<=\})\\n(?=\{)/);
      if (pieces.length > 1 && pieces.every(isParseableJsonObject)) {
        pending = "";
        count += pieces.length;
        return pieces;
      }
    }

    if (!pending && !line.startsWith("{")) return [];

    const candidate = pending ? `${pending}\n${line}` : line;
    if (isParseableJsonObject(candidate)) {
      pending = "";
      count += 1;
      return [candidate];
    }
    pending = candidate;
    return [];
  }

  return (function* generate(): Generator<string> {
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      for (const message of consumePhysicalLine(buffer.slice(0, newline))) {
        yield message;
      }
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    for (const message of consumePhysicalLine(buffer)) yield message;

    if (pending) {
      throw new IncompleteOutputError(
        `Model output ended with an incomplete JSON object: ${pending.slice(0, 200)}`,
      );
    }
    if (count === 0) {
      throw new IncompleteOutputError(
        "LLM agent produced no valid A2UI JSONL messages",
      );
    }
  })();
}

/** 判断字符串是否为可解析 JSON 对象（容忍内部空白/换行） */
function isParseableJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
}
