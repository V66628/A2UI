import OpenAI from "openai";
import { llmConfig } from "../config";
import type { ToolParameterSchema } from "../tools/agent-tool";

/** 文本/图片 content part（沿用 multimodal-chat 定义，此处重新声明避免环依赖） */
export interface TextPart {
  type: "text";
  text: string;
}
export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}
export type ContentPart = TextPart | ImagePart;

/** 模型发起的一次工具调用（arguments 为模型给出的 JSON 字符串） */
export interface RawToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 一轮对话中可发送的消息（OpenAI chat completions 形态）。
 * 含工具回路所需的 assistant(tool_calls) 与 role:"tool" 结果消息。
 */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: RawToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** 发送给模型的工具定义（OpenAI function tool） */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

/** 流式响应事件：正文增量 / 一个完整工具调用（响应结束时产出） */
export type CompletionEvent =
  | { type: "delta"; text: string }
  | { type: "toolCall"; toolCall: RawToolCall }
  | { type: "done"; finishReason: string | null };

/** 可注入的 completion 流式函数（测试 seam） */
export type CompletionStreamer = (
  messages: ChatMessage[],
  options: {
    model: string;
    tools?: ToolDefinition[];
  },
) => AsyncIterable<CompletionEvent>;

/**
 * 基于 OpenAI 兼容（oneapi）端点的真实流式 completion：
 * 逐 chunk 产出正文 delta；tool_calls 按 index 累积 id/name/arguments，
 * 在流结束时以完整 toolCall 事件产出（模型边写边拼 arguments，
 * 中途不完整不能执行）。finish_reason=length 明确报错。
 */
export const streamCompletion: CompletionStreamer =
  async function* streamCompletion(messages, options) {
    if (!llmConfig.apiKey || !llmConfig.baseURL) {
      throw new Error(
        "LLM is not configured: BASE_URL / API_KEY missing in .env",
      );
    }

    const client = new OpenAI({
      apiKey: llmConfig.apiKey,
      baseURL: llmConfig.baseURL,
    });

    const stream = await client.chat.completions.create({
      model: options.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      stream: true,
      max_tokens: llmConfig.maxTokens,
      tools:
        options.tools && options.tools.length > 0
          ? (options.tools as unknown as OpenAI.ChatCompletionTool[])
          : undefined,
    });

    // tool_call 按 index 累积（chunk delta 只给片段）
    const acc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        yield { type: "delta", text: choice.delta.content };
      }
      if (choice?.delta?.tool_calls) {
        for (const partial of choice.delta.tool_calls) {
          const index = partial.index;
          const current = acc.get(index) ?? { id: "", name: "", arguments: "" };
          if (partial.id) current.id = partial.id;
          if (partial.function?.name) current.name = partial.function.name;
          if (partial.function?.arguments) {
            current.arguments += partial.function.arguments;
          }
          acc.set(index, current);
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.finish_reason === "length") {
        throw new Error(
          `Model output was truncated at max_tokens=${llmConfig.maxTokens} (finish_reason=length). Raise MAX_TOKENS or simplify the request.`,
        );
      }
    }

    for (const call of acc.values()) {
      yield {
        type: "toolCall",
        toolCall: {
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        },
      };
    }

    yield { type: "done", finishReason };
  };
