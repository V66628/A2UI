import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeAgUI } from "../src/agui/encoder";
import type { AgUIEvent } from "../src/agui/events";

async function collect(
  source: AsyncIterable<string>,
  input = "hello",
): Promise<AgUIEvent[]> {
  const events: AgUIEvent[] = [];
  for await (const event of encodeAgUI(source, {
    threadId: "t1",
    runId: "r1",
    input,
  })) {
    events.push(event);
  }
  return events;
}

describe("AG-UI encoder", () => {
  it("应输出 RUN_STARTED → 每条 A2UI 消息一个 CUSTOM → RUN_FINISHED", async () => {
    async function* source() {
      yield JSON.stringify({ dataModelUpdate: { surfaceId: "main" } });
      yield JSON.stringify({ beginRendering: { surfaceId: "main" } });
    }

    const events = await collect(source());

    assert.equal(events.length, 4);
    assert.equal(events[0].type, "RUN_STARTED");
    const started = events[0] as {
      threadId: string;
      runId: string;
      input?: string;
    };
    assert.equal(started.threadId, "t1");
    assert.equal(started.runId, "r1");
    assert.equal(started.input, "hello");

    assert.equal(events[1].type, "CUSTOM");
    assert.equal((events[1] as { name: string }).name, "a2ui");
    assert.deepEqual((events[1] as { value: unknown }).value, {
      dataModelUpdate: { surfaceId: "main" },
    });

    assert.equal(events[2].type, "CUSTOM");
    assert.deepEqual((events[2] as { value: unknown }).value, {
      beginRendering: { surfaceId: "main" },
    });

    assert.equal(events[3].type, "RUN_FINISHED");
    const finished = events[3] as { threadId: string; runId: string };
    assert.equal(finished.threadId, "t1");
    assert.equal(finished.runId, "r1");
  });

  it("每个事件都带 ISO 时间戳", async () => {
    async function* source() {
      yield JSON.stringify({ x: 1 });
    }
    const events = await collect(source());
    for (const event of events) {
      assert.match((event as { timestamp: string }).timestamp, /\d{4}-/);
    }
  });

  it("上游抛错时应输出 RUN_ERROR 且没有 RUN_FINISHED", async () => {
    async function* source() {
      yield JSON.stringify({ ok: true });
      throw new Error("boom");
    }

    const events = await collect(source());
    assert.equal(events.at(-1)!.type, "RUN_ERROR");
    assert.equal((events.at(-1) as { message: string }).message, "boom");
    assert.ok(!events.some((event) => event.type === "RUN_FINISHED"));
  });

  it("A2UI 消息不是合法 JSON 时应输出 RUN_ERROR", async () => {
    async function* source() {
      yield "not-json";
    }
    const events = await collect(source());
    assert.equal(events.at(-1)!.type, "RUN_ERROR");
  });
});
