import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockAgent } from "../src/agent/mock-agent";

async function runMock(input: string): Promise<unknown[]> {
  const agent = new MockAgent();
  const messages: unknown[] = [];
  for await (const raw of agent.run({
    input,
    threadId: "t1",
    runId: "r1",
  })) {
    messages.push(JSON.parse(raw));
  }
  return messages;
}

describe("MockAgent", () => {
  it("首条为 dataModelUpdate，末条为 beginRendering", async () => {
    const messages = await runMock("build a cart");
    assert.equal(
      (messages[0] as Record<string, unknown>).dataModelUpdate !== undefined,
      true,
    );
    assert.equal(
      (messages.at(-1) as Record<string, unknown>).beginRendering !==
        undefined,
      true,
    );
  });

  it("用户输入应被写入 dataModel 的 /echo", async () => {
    const messages = await runMock("Hello A2UI");
    const first = messages[0] as {
      dataModelUpdate: { contents: Array<{ key: string; valueString?: string }> };
    };
    const echo = first.dataModelUpdate.contents.find(
      (entry) => entry.key === "echo",
    );
    assert.equal(echo?.valueString, "Hello A2UI");
  });

  it("空白输入应得到占位回显，生成的组件包含 Button localUpdate", async () => {
    const messages = await runMock("   ");
    const first = messages[0] as {
      dataModelUpdate: { contents: Array<{ key: string; valueString?: string }> };
    };
    const echo = first.dataModelUpdate.contents.find(
      (entry) => entry.key === "echo",
    );
    assert.equal(echo?.valueString, "(empty input)");

    const buttonMessage = messages.find(
      (message) =>
        (message as { surfaceUpdate?: unknown }).surfaceUpdate !== undefined &&
        JSON.stringify(message).includes("localUpdate"),
    );
    assert.ok(buttonMessage);
    assert.match(JSON.stringify(buttonMessage), /update_status/);
  });
});
