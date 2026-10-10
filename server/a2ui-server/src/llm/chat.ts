import OpenAI from "openai";
import { llmConfig } from "../config";

/** 对话消息（OpenAI chat completions 形态，仅文本） */
export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
}

/** 流式对话函数：逐段产出模型回复的文本增量 */
export type ChatStreamer = (
  messages: ChatMessage[],
  options?: { model?: string },
) => AsyncIterable<string>;

/**
 * 基于 OpenAI 兼容（oneapi）接口的流式对话：
 * 调用 {BASE_URL}/chat/completions（stream: true），逐 chunk 取出 delta 文本。
 */
export const streamChat: ChatStreamer = async function* streamChat(
  messages,
  options = {},
) {
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
    messages,
    stream: true,
    max_tokens: llmConfig.maxTokens,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
};
