import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import type { ChatMessage, ChatStreamer } from "../src/llm/chat";

/** 假流式模型：按固定节奏回显，便于断言（不访问真实 LLM） */
const fakeStreamer: ChatStreamer = async function* fakeStreamer(
  messages: ChatMessage[],
) {
  yield "echo: ";
  yield messages[0]?.content ?? "";
};

/** 抛错的流式模型：验证错误帧 */
const failingStreamer: ChatStreamer = async function* failingStreamer() {
  yield "partial";
  throw new Error("model boom");
};

let server: Server;
let baseUrl: string;

function startWith(streamer: ChatStreamer): void {
  server = createApp(undefined, streamer).listen(0);
}

before(async () => {
  startWith(fakeStreamer);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 读取 SSE 响应并解析全部 data JSON 帧 */
async function readSSEFrames(response: Response): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const frame of parts) {
      const line = frame
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (line) frames.push(JSON.parse(line.slice(6)));
    }
  }
  return frames;
}

describe("POST /chat 模型对话接口", () => {
  it("SSE 流式：逐帧 delta，末帧 done:true，拼出完整回复", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello model" }),
    });

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );

    const frames = (await readSSEFrames(response)) as Array<{
      delta?: string;
      done?: boolean;
    }>;
    assert.equal(frames[0].delta, "echo: ");
    assert.equal(frames[1].delta, "hello model");
    assert.deepEqual(frames[2], { done: true });

    const reply = frames
      .map((frame) => frame.delta ?? "")
      .join("");
    assert.equal(reply, "echo: hello model");
  });

  it("透传 messages 数组（含多角色），模型收到原始内容", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "question x" },
        ],
      }),
    });

    const frames = (await readSSEFrames(response)) as Array<{
      delta?: string;
    }>;
    // fakeStreamer 回显首条消息（system），验证 messages 被原样传入
    assert.equal(frames[0].delta, "echo: ");
    assert.equal(frames[1].delta, "be brief");
  });

  it("忽略非法 message 条目，但只要有合法条目即正常处理", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "bad-role", content: "nope" },
          "not-an-object",
          { role: "user", content: "valid one" },
        ],
      }),
    });
    assert.equal(response.status, 200);
    const frames = (await readSSEFrames(response)) as Array<{
      delta?: string;
    }>;
    assert.equal(frames[1].delta, "valid one");
  });

  it("?stream=false 非流式：一次性返回 {reply}", async () => {
    const response = await fetch(`${baseUrl}/chat?stream=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "non stream q" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { reply: string };
    assert.equal(body.reply, "echo: non stream q");
  });

  it("缺少输入返回 400", async () => {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.match(body.error ?? "", /Missing chat input/);
  });

  it("模型抛错时以 {error} 帧收尾（此前的 delta 仍保留）", async () => {
    // 另起一个使用 failingStreamer 的 server
    const errorServer = createApp(undefined, failingStreamer).listen(0);
    await new Promise<void>((resolve) => errorServer.once("listening", resolve));
    const { port } = errorServer.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${port}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "trigger failure" }),
      },
    );
    const frames = (await readSSEFrames(response)) as Array<{
      delta?: string;
      error?: string;
    }>;
    assert.equal(frames[0].delta, "partial");
    assert.equal(frames[1].error, "model boom");

    await new Promise<void>((resolve) =>
      errorServer.close(() => resolve()),
    );
  });
});
