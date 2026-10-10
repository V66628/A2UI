import { llmConfig } from "../config";
import {
  streamMultimodalChat,
  type ContentPart,
  type MultimodalChatMessage,
  type MultimodalChatStreamer,
} from "../llm/multimodal-chat";
import { buildSystemPrompt } from "./prompt";
import type { AgentRunInput, A2UIAgent } from "./types";

export interface LLMAgentOptions {
  /** 覆盖文本模型 */
  model?: string;
  /** 覆盖视觉模型（附带图片时使用） */
  visionModel?: string;
  /** 注入多模态流式函数（测试用 fake；缺省走真实 OpenAI 兼容端点） */
  streamer?: MultimodalChatStreamer;
}

/** 输出不完整（流末对象未闭合 / 未产出任何消息）时可安全重试 */
class IncompleteOutputError extends Error {}

/** 输出不完整时的最大尝试次数（含首次） */
const MAX_ATTEMPTS = 3;

/**
 * LLM A2UI Agent：
 *   system（prompt 模板 + Renderer Catalog）
 *   user（文本 + 可选图片 content parts）
 * → 多模态模型逐段输出 JSONL 文本 → 按行切分、校验后逐条产出 A2UI 消息。
 *
 * 附带图片时自动切换到视觉模型（VISION_MODEL，缺省 qwen3-vl-flash）。
 *
 * 模型非确定性容错：
 *   - 对象被 pretty-print 到多个物理行 → 累积拼接；
 *   - 对象之间误输出字面量 "\n"（反斜杠+n）而非真实换行 → 自动拆分；
 *   - 流末对象未闭合 / 一条合法消息都没有 → 追加纠错 developer 消息后重试，
 *     最多 MAX_ATTEMPTS 次；仍失败则抛错（由外层编码为 RUN_ERROR）。
 */
export class LLMAgent implements A2UIAgent {
  private readonly model?: string;
  private readonly visionModel?: string;
  private readonly streamer: MultimodalChatStreamer;

  constructor(options: LLMAgentOptions = {}) {
    this.model = options.model;
    this.visionModel = options.visionModel;
    this.streamer = options.streamer ?? streamMultimodalChat;
  }

  async *run(input: AgentRunInput): AsyncGenerator<string> {
    const images = input.images ?? [];
    const parts: ContentPart[] = [{ type: "text", text: input.input }];
    for (const image of images) {
      parts.push({ type: "image_url", image_url: { url: image.url } });
    }

    const messages: MultimodalChatMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: parts },
    ];

    const model =
      images.length > 0
        ? (this.visionModel ?? llmConfig.visionModel)
        : (this.model ?? llmConfig.model);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const attemptMessages =
        attempt === 1
          ? messages
          : [
              ...messages,
              {
                // 用 system 而非 OpenAI 的 developer：阿里云/部分兼容端点
                // 不接受 developer 角色（会 400）
                role: "system" as const,
                content:
                  `Your previous response (attempt ${attempt - 1}) was incomplete or was not valid JSONL. ` +
                  "Regenerate the COMPLETE response from scratch: one JSON object per physical line " +
                  "(a real newline, never the literal characters backslash-n), each object fully closed, " +
                  "and beginRendering must be the last line. Do not repeat or explain.",
              },
            ];

      try {
        yield* this.runAttempt(attemptMessages, model);
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

  /** 单次尝试：流式消费模型输出，切分/校验后逐条产出协议消息 */
  private async *runAttempt(
    messages: MultimodalChatMessage[],
    model: string,
  ): AsyncGenerator<string> {
    let buffer = "";
    let pending = "";
    let emitted = 0;

    /**
     * 消费一个物理行，返回本行产出的 0..N 条消息：
     *   - 空行 / 代码围栏行 → 跳过；
     *   - 无待闭合对象时，非以 { 起始的杂散文本 → 跳过；
     *   - 以 { 起始则尝试 parse：单行完整对象直接产出；
     *     parse 失败说明模型在对象内部换行了（pretty-print），
     *     累积后续物理行（保留换行）直到拼成完整对象再产出；
     *   - 若一行 parse 失败且包含 `}\n{` 形态的字面量反斜杠+n
     *     （模型把换行写成了字面量），拆分为多个对象分别产出。
     */
    const processPhysicalLine = (physical: string): string[] => {
      const line = physical.trim();
      if (!line || line.startsWith("```")) return [];

      if (!isParseableJsonObject(line) && line.includes("\\n")) {
        const pieces = line.split(/(?<=\})\\n(?=\{)/);
        if (
          pieces.length > 1 &&
          pieces.every((piece) => isParseableJsonObject(piece))
        ) {
          pending = "";
          emitted += pieces.length;
          return pieces;
        }
      }

      if (!pending && !line.startsWith("{")) return [];

      const candidate = pending ? `${pending}\n${line}` : line;
      if (isParseableJsonObject(candidate)) {
        pending = "";
        emitted += 1;
        return [candidate];
      }
      pending = candidate;
      return [];
    };

    for await (const delta of this.streamer(messages, { model })) {
      buffer += delta;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        for (const message of processPhysicalLine(buffer.slice(0, newline))) {
          yield message;
        }
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }

    for (const message of processPhysicalLine(buffer)) yield message;

    // 流结束仍有未闭合对象 → 模型输出损坏，标记可重试
    if (pending) {
      throw new IncompleteOutputError(
        `Model output ended with an incomplete JSON object: ${pending.slice(0, 200)}`,
      );
    }

    if (emitted === 0) {
      throw new IncompleteOutputError(
        "LLM agent produced no valid A2UI JSONL messages",
      );
    }
  }
}

/** 判断字符串是否为可解析的 JSON 对象（容忍内部空白/换行） */
function isParseableJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
}
