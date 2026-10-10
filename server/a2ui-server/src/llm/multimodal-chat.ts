import OpenAI from "openai";
import { llmConfig } from "../config";

/** 文本 content part */
export interface TextContentPart {
  type: "text";
  text: string;
}

/** 图片 content part：url 可为远端 URL 或 data URL（base64） */
export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

export type ContentPart = TextContentPart | ImageContentPart;

/**
 * 多模态对话消息（OpenAI chat completions 形态）。
 * 不含 "developer"：当前接入的阿里云等兼容端点不接受该角色（会 400），
 * 纠错指令统一用 system。
 */
export interface MultimodalChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** 多模态流式对话函数：逐段产出模型回复的文本增量 */
export type MultimodalChatStreamer = (
  messages: MultimodalChatMessage[],
  options?: { model?: string },
) => AsyncIterable<string>;

/**
 * 基于 OpenAI 兼容（oneapi）接口的多模态流式对话：
 * 支持 user 消息携带 image_url parts（截图/草图/设计稿），
 * 调用 {BASE_URL}/chat/completions（stream: true），逐 chunk 取出 delta 文本。
 */
export const streamMultimodalChat: MultimodalChatStreamer =
  async function* streamMultimodalChat(messages, options = {}) {
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
      model: options.model ?? llmConfig.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      stream: true,
      max_tokens: llmConfig.maxTokens,
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) yield delta;
      // 因 max_tokens 被截断：明确报错而非让下游拿到未闭合 JSON
      if (choice?.finish_reason === "length") {
        throw new Error(
          `Model output was truncated at max_tokens=${llmConfig.maxTokens} (finish_reason=length). Raise MAX_TOKENS or simplify the request.`,
        );
      }
    }
  };
