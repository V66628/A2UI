import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import type { AgUIEvent } from "../src/agui/events";

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 读取 SSE 响应并解析出全部 AG-UI 事件 */
async function readSSEEvents(response: Response): Promise<AgUIEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AgUIEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)) as AgUIEvent);
    }
  }
  return events;
}

describe("HTTP 接口", () => {
  it("GET /health 返回 200 ok", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("POST / 以 input 流式返回 AG-UI 事件：RUN_STARTED … CUSTOM(a2ui) … RUN_FINISHED", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "show my cart" }),
    });

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );

    const events = await readSSEEvents(response);

    assert.equal(events[0].type, "RUN_STARTED");
    assert.equal(events.at(-1)!.type, "RUN_FINISHED");

    const customs = events.filter((event) => event.type === "CUSTOM") as Array<{
      name: string;
      value: Record<string, unknown>;
    }>;
    assert.ok(customs.length >= 3);
    assert.ok(customs.every((event) => event.name === "a2ui"));

    // 首条业务载荷为含用户输入的 dataModelUpdate
    const firstPayload = customs[0].value;
    assert.ok(firstPayload.dataModelUpdate);
    assert.match(JSON.stringify(firstPayload), /show my cart/);

    // 末条业务载荷为 beginRendering
    assert.ok(customs.at(-1)!.value.beginRendering);
  });

  it("POST / 兼容 AG-UI messages 形态（取最后一条 user 消息）", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-fixed",
        runId: "run-fixed",
        messages: [
          { role: "user", content: "earlier message" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "latest question" },
        ],
      }),
    });

    const events = await readSSEEvents(response);
    assert.equal(events[0].type, "RUN_STARTED");
    assert.equal((events[0] as { threadId: string }).threadId, "thread-fixed");
    const customs = events.filter((event) => event.type === "CUSTOM");
    assert.match(JSON.stringify(customs[0]), /latest question/);
  });

  it("?stream=false 非流式：一次性返回 JSON，内含完整 AG-UI 事件数组", async () => {
    const response = await fetch(`${baseUrl}?stream=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "non-streaming call",
        threadId: "t-json",
        runId: "r-json",
      }),
    });

    assert.equal(response.status, 200);
    // 非 SSE：普通 JSON 响应
    assert.doesNotMatch(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );

    const body = (await response.json()) as {
      threadId: string;
      runId: string;
      events: AgUIEvent[];
    };
    assert.equal(body.threadId, "t-json");
    assert.equal(body.runId, "r-json");

    const { events } = body;
    assert.equal(events[0].type, "RUN_STARTED");
    assert.equal(events.at(-1)!.type, "RUN_FINISHED");

    const customs = events.filter((event) => event.type === "CUSTOM") as Array<{
      value: Record<string, unknown>;
    }>;
    assert.ok(customs.length >= 3);
    assert.match(JSON.stringify(events), /non-streaming call/);
    // 末条业务载荷为 beginRendering
    assert.ok(customs.at(-1)!.value.beginRendering);
  });

  it("?sse=0 别名同样生效：返回非流式 JSON", async () => {
    const response = await fetch(`${baseUrl}?sse=0`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "alias check" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { events: AgUIEvent[] };
    assert.ok(Array.isArray(body.events));
    assert.equal(body.events[0].type, "RUN_STARTED");
  });

  it("?stream=true 显式流式：仍返回 text/event-stream", async () => {
    const response = await fetch(`${baseUrl}?stream=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "explicit stream" }),
    });
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/,
    );
    await response.body!.cancel();
  });

  it("缺少输入时返回 400", async () => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string };
    assert.match(body.error ?? "", /Missing user input/);
  });
});
