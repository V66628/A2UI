import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import { LLMAgent } from "../src/agent/llm-agent";
import { buildSystemPrompt } from "../src/agent/prompt";
import type { AgentRunInput } from "../src/agent/types";
import type {
  ContentPart,
  MultimodalChatMessage,
  MultimodalChatStreamer,
} from "../src/llm/multimodal-chat";

const CANNED_JSONL = [
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["t"]}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"t","component":{"Text":{"text":{"literalString":"Hi"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"root"}}',
].join("\n");

/** 把文本切成不规则小块，模拟模型逐 token 流式输出 */
function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/** 记录调用信息的假多模态 streamer */
function recordingStreamer(output: string): {
  streamer: MultimodalChatStreamer;
  calls: Array<{ messages: MultimodalChatMessage[]; model?: string }>;
} {
  const calls: Array<{
    messages: MultimodalChatMessage[];
    model?: string;
  }> = [];
  const streamer: MultimodalChatStreamer = async function* streamer(
    messages,
    options,
  ) {
    calls.push({ messages, model: options?.model });
    for (const chunk of chunkText(output, 7)) yield chunk;
  };
  return { streamer, calls };
}

async function collect(
  agent: LLMAgent,
  run: Omit<AgentRunInput, "threadId" | "runId">,
): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of agent.run({
    ...run,
    threadId: "th",
    runId: "rn",
  })) {
    lines.push(line);
  }
  return lines;
}

describe("A2UI prompt 组装", () => {
  it("system prompt 注入 Renderer Catalog，无残留占位符，包含全部支持组件", () => {
    const prompt = buildSystemPrompt();
    assert.doesNotMatch(prompt, /\{\{[^}]+\}\}/);
    assert.match(prompt, /renderer_catalog\.json/);
    for (const type of [
      "Text",
      "Row",
      "Column",
      "List",
      "Button",
      "TextField",
    ]) {
      assert.match(prompt, new RegExp(`"${type}"`));
    }
    assert.match(prompt, /A2UI Generation Agent/);
  });
});

describe("LLMAgent", () => {
  it("流式 JSONL 跨 chunk 切分后仍完整恢复，beginRendering 在最后", async () => {
    const { streamer } = recordingStreamer(CANNED_JSONL);
    const agent = new LLMAgent({ streamer });

    const lines = await collect(agent, { input: "build something" });

    assert.equal(lines.length, 3);
    const parsed = lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    assert.ok(parsed[0].surfaceUpdate);
    assert.ok(parsed[1].surfaceUpdate);
    assert.deepEqual(parsed[2], {
      beginRendering: { surfaceId: "main", root: "root" },
    });
  });

  it("丢弃代码围栏/空行/杂散文本，只产出合法协议行", async () => {
    const noisy = ["```json", CANNED_JSONL, "", "here is your UI", "```"].join(
      "\n",
    );
    const { streamer } = recordingStreamer(noisy);
    const agent = new LLMAgent({ streamer });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 3);
  });

  it("文本输入用文本模型；附带图片时切换视觉模型并以 image_url part 传入", async () => {
    const { streamer, calls } = recordingStreamer(CANNED_JSONL);
    const agent = new LLMAgent({ streamer });

    await collect(agent, { input: "text only" });
    assert.equal(calls[0].model, "qwen3.8-flash");
    assert.equal(Array.isArray(calls[0].messages[1].content), true);

    await collect(agent, {
      input: "from sketch",
      images: [{ url: "data:image/png;base64,AAA=" }],
    });
    assert.equal(calls[1].model, "qwen3-vl-flash");
    const userContent = calls[1].messages[1].content;
    assert.ok(Array.isArray(userContent));
    const parts = userContent as ContentPart[];
    assert.equal(parts[0].type, "text");
    assert.equal(parts[1].type, "image_url");
    assert.deepEqual(
      parts[1].type === "image_url" ? parts[1].image_url : undefined,
      { url: "data:image/png;base64,AAA=" },
    );
  });

  it("可显式覆盖文本/视觉模型", async () => {
    const { streamer, calls } = recordingStreamer(CANNED_JSONL);
    const agent = new LLMAgent({
      streamer,
      model: "custom-text",
      visionModel: "custom-vision",
    });

    await collect(agent, { input: "a" });
    assert.equal(calls[0].model, "custom-text");
    await collect(agent, {
      input: "b",
      images: [{ url: "data:image/png;base64,AAA=" }],
    });
    assert.equal(calls[1].model, "custom-vision");
  });

  it("模型未产出任何合法行时抛错", async () => {
    const empty: MultimodalChatStreamer = async function* empty() {
      yield "no json here\n";
    };
    const agent = new LLMAgent({ streamer: empty });
    await assert.rejects(collect(agent, { input: "x" }), /no valid A2UI JSONL/);
  });

  it("对象跨多个物理行（pretty-print）时累积恢复为完整协议消息", async () => {
    const pretty = [
      "{",
      '  "surfaceUpdate": {',
      '    "surfaceId": "main",',
      '    "components": [',
      '      {"id": "root", "component": {"Column": {"children": {"explicitList": ["t"]}}}}',
      "    ]",
      "  }",
      "}",
      CANNED_JSONL.split("\n")[2],
    ].join("\n");
    const { streamer } = recordingStreamer(pretty);
    const agent = new LLMAgent({ streamer });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 2);
    const parsed = JSON.parse(lines[0]) as {
      surfaceUpdate?: { components?: Array<{ id: string }> };
    };
    assert.equal(parsed.surfaceUpdate?.components?.[0]?.id, "root");
  });

  it("对象之间被写成字面量反斜杠+n 时拆分为多个对象", async () => {
    // 单个物理行：两个对象之间是字面量 \n（两个字符），不是真实换行
    const literal =
      '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[]}}' +
      "\\n" +
      '{"beginRendering":{"surfaceId":"main","root":"root"}}';
    const { streamer } = recordingStreamer(literal);
    const agent = new LLMAgent({ streamer });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[1]), {
      beginRendering: { surfaceId: "main", root: "root" },
    });
  });

  it("首次输出不完整时自动重试，后续成功则产出完整协议", async () => {
    let calls = 0;
    const streamer: MultimodalChatStreamer = async function* streamer(
      messages,
    ) {
      calls += 1;
      const output =
        calls === 1
          ? '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root"'
          : CANNED_JSONL;
      // 第二次调用应附带纠错 system 消息（该端点不接受 developer）
      if (calls === 2) {
        assert.ok(
          messages.some(
            (message) =>
              message.role === "system" &&
              typeof message.content === "string" &&
              message.content.includes("incomplete"),
          ),
        );
      }
      for (const chunk of chunkText(output, 7)) yield chunk;
    };
    const agent = new LLMAgent({ streamer });

    const lines = await collect(agent, { input: "x" });
    assert.equal(calls, 2);
    assert.equal(lines.length, 3);
  });

  it("流结束时 JSON 对象仍未闭合，重试耗尽后抛错（由外层编码为 RUN_ERROR）", async () => {
    const broken: MultimodalChatStreamer = async function* broken() {
      yield '{"surfaceUpdate":{"surfaceId":"main"\n';
    };
    const agent = new LLMAgent({ streamer: broken });
    await assert.rejects(
      collect(agent, { input: "x" }),
      /incomplete JSON object/,
    );
  });
});

// ---- HTTP 集成：POST / 携带 base64 图片 → AG-UI 事件流 ----

let server: Server;
let baseUrl: string;

before(async () => {
  const { streamer } = recordingStreamer(CANNED_JSONL);
  server = createApp(new LLMAgent({ streamer })).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

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

describe("POST / 多模态 A2UI 生成（HTTP）", () => {
  it("base64 图片归一化为 data URL，返回的 AG-UI 流含 CUSTOM a2ui 与 RUN_FINISHED", async () => {
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "按图生成",
        images: [
          { base64: "QUJDRA==", mediaType: "image/png" },
          { url: "https://example.com/ref.png" },
          "bad entry",
        ],
      }),
    });

    assert.equal(response.status, 200);
    const frames = (await readSSEFrames(response)) as Array<{
      type: string;
      name?: string;
    }>;

    const types = frames.map((frame) => frame.type);
    assert.equal(types[0], "RUN_STARTED");
    assert.equal(types[types.length - 1], "RUN_FINISHED");
    const custom = frames.filter((frame) => frame.type === "CUSTOM");
    assert.equal(custom.length, 3);
    assert.ok(custom.every((frame) => frame.name === "a2ui"));
  });
});
