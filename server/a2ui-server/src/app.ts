import Koa from "koa";
import bodyParser from "koa-bodyparser";
import Router from "@koa/router";
import { randomUUID } from "node:crypto";
import { MockAgent } from "./agent/mock-agent";
import type { AgentImageInput, A2UIAgent } from "./agent/types";
import { encodeAgUI } from "./agui/encoder";
import type { AgUIEvent } from "./agui/events";
import { streamChat, type ChatMessage, type ChatStreamer } from "./llm/chat";
import { createSSEStream } from "./sse";

/**
 * 解析 query 中的 `stream`（别名 `sse`）开关：
 *   ?stream=true / 1        → SSE 流式（默认，缺省时也走流式）
 *   ?stream=false / 0       → 非流式：收集全部 AG-UI 事件后一次性返回 JSON
 */
function resolveStreamFlag(ctx: Router.RouterContext): boolean {
  const raw = (ctx.query.stream ?? ctx.query.sse) as string | undefined;
  if (raw === undefined) return true;
  return raw === "true" || raw === "1";
}

/** 从请求体解析用户文本输入（兼容自有 input 字段与 AG-UI messages 形态） */
function resolveUserInput(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;

  if (typeof record.input === "string") return record.input;

  if (Array.isArray(record.messages)) {
    for (let i = record.messages.length - 1; i >= 0; i--) {
      const message = record.messages[i] as
        | { role?: string; content?: unknown }
        | undefined;
      if (message?.role !== "user") continue;
      const { content } = message;
      if (typeof content === "string") return content;
      // AG-UI content parts 形态：[{ type:"text", text:"..." }]
      if (Array.isArray(content)) {
        const textPart = content.find(
          (part) =>
            typeof part === "object" &&
            part !== null &&
            (part as { type?: string; text?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
        );
        if (textPart) {
          return (textPart as { text: string }).text;
        }
      }
    }
  }

  return undefined;
}

/**
 * 从请求体解析多模态图片输入：
 *   images: [{ url } | { dataUrl } | { base64, mediaType? }]
 * base64 归一化为 data URL；非法条目跳过；无有效图片返回 undefined。
 */
function resolveImages(
  body: Record<string, unknown>,
): AgentImageInput[] | undefined {
  if (!Array.isArray(body.images)) return undefined;

  const images: AgentImageInput[] = [];
  for (const rawItem of body.images) {
    if (typeof rawItem !== "object" || rawItem === null) continue;
    const item = rawItem as Record<string, unknown>;

    if (typeof item.url === "string" && item.url.trim()) {
      images.push({ url: item.url.trim() });
    } else if (typeof item.dataUrl === "string" && item.dataUrl.trim()) {
      images.push({ url: item.dataUrl.trim() });
    } else if (typeof item.base64 === "string" && item.base64.trim()) {
      const mediaType =
        typeof item.mediaType === "string" && item.mediaType.trim()
          ? item.mediaType.trim()
          : "image/png";
      images.push({
        url: `data:${mediaType};base64,${item.base64.trim()}`,
      });
    }
  }

  return images.length > 0 ? images : undefined;
}

/** 允许的对话角色 */
const CHAT_ROLES = ["system", "developer", "user", "assistant"] as const;

/**
 * 从请求体解析模型对话消息：
 *   优先使用 messages 数组（每项须有合法 role 与字符串 content）；
 *   否则使用 input 单条 user 消息。均不合法返回 undefined。
 */
function resolveChatMessages(body: unknown): ChatMessage[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;

  if (Array.isArray(record.messages)) {
    const messages: ChatMessage[] = [];
    for (const entry of record.messages) {
      if (typeof entry !== "object" || entry === null) continue;
      const item = entry as Record<string, unknown>;
      if (
        typeof item.role === "string" &&
        (CHAT_ROLES as readonly string[]).includes(item.role) &&
        typeof item.content === "string"
      ) {
        messages.push({
          role: item.role as ChatMessage["role"],
          content: item.content,
        });
      }
    }
    if (messages.length > 0) return messages;
  }

  if (typeof record.input === "string" && record.input.trim() !== "") {
    return [{ role: "user", content: record.input }];
  }

  return undefined;
}

/**
 * 创建 Koa 应用（agent / chatStreamer 可注入，便于测试替换 mock）。
 *
 * 路由：
 *   GET  /health  健康检查
 *   POST /        输入文本 → AG-UI 事件流
 *                  ?stream=true（默认）SSE 流式传输
 *                  ?stream=false      收集全部事件一次性返回 JSON
 *   POST /chat    纯模型对话（OpenAI 兼容 / oneapi）
 *                  ?stream=true（默认）SSE 逐帧 {delta} … {done:true}
 *                  ?stream=false      一次性 {reply}
 */
export function createApp(
  agent: A2UIAgent = new MockAgent(),
  chatStreamer: ChatStreamer = streamChat,
): Koa {
  const app = new Koa();
  app.proxy = true;

  // 最小 CORS：允许 playground（不同端口/源）直接调用；
  // 处理浏览器 POST application/json 的 OPTIONS 预检
  app.use(async (ctx, next) => {
    ctx.set("Access-Control-Allow-Origin", "*");
    ctx.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    ctx.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (ctx.method === "OPTIONS") {
      ctx.status = 204;
      return;
    }
    await next();
  });

  app.use(bodyParser({ enableTypes: ["json"] }));

  const router = new Router();

  router.get("/health", (ctx) => {
    ctx.body = { status: "ok" };
  });

  router.post("/", async (ctx) => {
    const input = resolveUserInput(ctx.request.body);
    if (input === undefined || input.trim() === "") {
      ctx.status = 400;
      ctx.body = {
        error:
          "Missing user input: provide `input` or a user `messages` entry.",
      };
      return;
    }

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const threadId =
      typeof body.threadId === "string" ? body.threadId : randomUUID();
    const runId = typeof body.runId === "string" ? body.runId : randomUUID();
    const images = resolveImages(body);

    const a2uiStream = agent.run({ input, images, threadId, runId });
    const aguiStream = encodeAgUI(a2uiStream, { threadId, runId, input });

    // 默认 SSE 流式；?stream=false 时一次性 JSON 返回
    if (resolveStreamFlag(ctx)) {
      const sse = createSSEStream(ctx);
      for await (const event of aguiStream) {
        if (sse.closed) return;
        sse.send(event);
      }
      sse.end();
      return;
    }

    const events: AgUIEvent[] = [];
    for await (const event of aguiStream) events.push(event);
    ctx.body = { threadId, runId, events };
  });

  // ---- 纯模型对话接口 ----
  router.post("/chat", async (ctx) => {
    const messages = resolveChatMessages(ctx.request.body);
    if (!messages) {
      ctx.status = 400;
      ctx.body = {
        error: "Missing chat input: provide `input` or non-empty `messages`.",
      };
      return;
    }

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model : undefined;

    // 默认 SSE：{delta} × N → {done:true}；异常以 {error} 收尾
    if (resolveStreamFlag(ctx)) {
      const sse = createSSEStream(ctx);
      try {
        for await (const delta of chatStreamer(messages, { model })) {
          if (sse.closed) return;
          sse.sendData({ delta });
        }
        if (!sse.closed) {
          sse.sendData({ done: true });
          sse.end();
        }
      } catch (error) {
        if (!sse.closed) {
          sse.sendData({
            error: error instanceof Error ? error.message : String(error),
          });
          sse.end();
        }
      }
      return;
    }

    // ?stream=false：聚合后一次性 JSON 返回
    let reply = "";
    for await (const delta of chatStreamer(messages, { model })) {
      reply += delta;
    }
    ctx.body = { reply };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
