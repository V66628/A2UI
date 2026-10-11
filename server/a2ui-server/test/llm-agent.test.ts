import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import { LLMAgent } from "../src/agent/llm-agent";
import { buildSystemPrompt } from "../src/agent/prompt";
import type { AgentRunInput } from "../src/agent/types";
import type { AgentTool } from "../src/tools/agent-tool";
import type {
  ChatMessage,
  CompletionEvent,
  CompletionStreamer,
  ContentPart,
  RawToolCall,
} from "../src/llm/completion";

const CANNED_JSONL = [
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["t"]}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"t","component":{"Text":{"text":{"literalString":"Hi"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"root"}}',
].join("\n");

/** 微调轮的最小增量补丁（改一个绑定值后重新渲染） */
const DELTA_JSONL = [
  '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"title","valueString":"New Title"}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"root"}}',
].join("\n");

/** 把文本切成不规则小块，模拟逐 token 流式输出 */
function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/** 正文响应事件（分片 delta + done） */
function textEvents(text: string, finishReason = "stop"): CompletionEvent[] {
  const events: CompletionEvent[] = chunkText(text, 7).map((chunk) => ({
    type: "delta",
    text: chunk,
  }));
  events.push({ type: "done", finishReason });
  return events;
}

/** 工具调用响应事件 */
function toolCallEvents(call: RawToolCall): CompletionEvent[] {
  return [
    { type: "toolCall", toolCall: call },
    { type: "done", finishReason: "tool_calls" },
  ];
}

function makeToolCall(name: string, args: unknown, id = "call-1"): RawToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    },
  };
}

/**
 * 按调用次序给出脚本化事件的假 completion streamer：
 * 第 n 次调用消费 scripts[n-1]，越界后重复最后一个。
 */
function scriptedStreamer(scripts: CompletionEvent[][]): {
  streamer: CompletionStreamer;
  calls: Array<{ messages: ChatMessage[]; model?: string }>;
} {
  const calls: Array<{ messages: ChatMessage[]; model?: string }> = [];
  const streamer: CompletionStreamer = async function* streamer(
    messages,
    options,
  ) {
    calls.push({ messages, model: options.model });
    const events = scripts[Math.min(calls.length - 1, scripts.length - 1)];
    for (const event of events) yield event;
  };
  return { streamer, calls };
}

/** 记录执行情况的假工具 */
function countingTool(name = "countTool"): {
  tool: AgentTool;
  executions: Array<Record<string, unknown>>;
} {
  const executions: Array<Record<string, unknown>> = [];
  const tool: AgentTool = {
    name,
    description: "test tool that records executions",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    async execute(args) {
      executions.push(args);
      return JSON.stringify({ ok: true });
    },
  };
  return { tool, executions };
}

/** collect 调用计数器：每次调用给独立线程，避免全局历史串扰单轮测试 */
let collectSeq = 0;

async function collect(
  agent: LLMAgent,
  run: Omit<AgentRunInput, "threadId" | "runId">,
): Promise<string[]> {
  collectSeq += 1;
  const threadId = `th-${collectSeq}`;
  const lines: string[] = [];
  for await (const line of agent.run({
    ...run,
    threadId,
    runId: `rn-${collectSeq}`,
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
      "Icon",
    ]) {
      assert.match(prompt, new RegExp(`"${type}"`));
    }
    assert.match(prompt, /A2UI Generation Agent/);
  });
});

describe("LLMAgent 最终正文提取", () => {
  it("流式 JSONL 跨 chunk 切分后仍完整恢复，beginRendering 在最后", async () => {
    const { streamer } = scriptedStreamer([textEvents(CANNED_JSONL)]);
    const agent = new LLMAgent({ streamer, tools: [] });

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
    const { streamer } = scriptedStreamer([textEvents(noisy)]);
    const agent = new LLMAgent({ streamer, tools: [] });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 3);
  });

  it("文本输入用文本模型；附带图片时切换视觉模型并以 image_url part 传入", async () => {
    const { streamer, calls } = scriptedStreamer([textEvents(CANNED_JSONL)]);
    const agent = new LLMAgent({ streamer, tools: [] });

    await collect(agent, { input: "text only" });
    assert.equal(calls[0].model, "qwen3.8-flash");
    assert.equal(Array.isArray(calls[0].messages[1].content), true);

    await collect(agent, {
      input: "from sketch",
      images: [{ url: "data:image/png;base64,AAA=" }],
    });
    assert.equal(calls[1].model, "qwen3.5-omni-plus");
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
    const { streamer, calls } = scriptedStreamer([textEvents(CANNED_JSONL)]);
    const agent = new LLMAgent({
      streamer,
      tools: [],
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
    const { streamer } = scriptedStreamer([textEvents("no json here\n")]);
    const agent = new LLMAgent({ streamer, tools: [] });
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
    const { streamer } = scriptedStreamer([textEvents(pretty)]);
    const agent = new LLMAgent({ streamer, tools: [] });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 2);
    const parsed = JSON.parse(lines[0]) as {
      surfaceUpdate?: { components?: Array<{ id: string }> };
    };
    assert.equal(parsed.surfaceUpdate?.components?.[0]?.id, "root");
  });

  it("对象之间被写成字面量反斜杠+n 时拆分为多个对象", async () => {
    const literal =
      '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[]}}' +
      "\\n" +
      '{"beginRendering":{"surfaceId":"main","root":"root"}}';
    const { streamer } = scriptedStreamer([textEvents(literal)]);
    const agent = new LLMAgent({ streamer, tools: [] });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[1]), {
      beginRendering: { surfaceId: "main", root: "root" },
    });
  });

  it("首次输出不完整时自动重试，后续成功则产出完整协议", async () => {
    const { streamer, calls } = scriptedStreamer([
      textEvents(
        '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root"',
      ),
      textEvents(CANNED_JSONL),
    ]);
    const agent = new LLMAgent({ streamer, tools: [] });

    const lines = await collect(agent, { input: "x" });
    assert.equal(calls.length, 2);
    assert.equal(lines.length, 3);
    // 第二次调用应附带纠错 system 消息（该端点不接受 developer）
    assert.ok(
      calls[1].messages.some(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes("incomplete"),
      ),
    );
  });

  it("流结束时 JSON 对象仍未闭合，重试耗尽后抛错（由外层编码为 RUN_ERROR）", async () => {
    const { streamer } = scriptedStreamer([
      textEvents('{"surfaceUpdate":{"surfaceId":"main"\n'),
    ]);
    const agent = new LLMAgent({ streamer, tools: [] });
    await assert.rejects(
      collect(agent, { input: "x" }),
      /incomplete JSON object/,
    );
  });
});

describe("LLMAgent 工具回路", () => {
  it("模型先发起工具调用、拿到结果后再产出最终协议；工具被执行且 onToolCall 回调", async () => {
    const { tool, executions } = countingTool();
    const { streamer, calls } = scriptedStreamer([
      toolCallEvents(makeToolCall("countTool", { query: "home" })),
      textEvents(CANNED_JSONL),
    ]);
    const toolNames: string[] = [];
    const agent = new LLMAgent({
      streamer,
      tools: [tool],
      onToolCall: (name) => toolNames.push(name),
    });

    const lines = await collect(agent, { input: "x" });

    assert.equal(lines.length, 3);
    assert.equal(executions.length, 1);
    assert.deepEqual(executions[0], { query: "home" });
    assert.deepEqual(toolNames, ["countTool"]);
    // 第二轮消息含 assistant(tool_calls) 与 role:"tool" 结果
    const secondRoundMessages = calls[1].messages;
    assert.ok(
      secondRoundMessages.some((m) => m.role === "assistant" && m.tool_calls),
    );
    assert.ok(secondRoundMessages.some((m) => m.role === "tool"));
  });

  it("工具参数不是合法 JSON 时回灌错误结果，模型随后给出最终答案", async () => {
    const { tool, executions } = countingTool();
    const { streamer } = scriptedStreamer([
      toolCallEvents(makeToolCall("countTool", "not-json")),
      textEvents(CANNED_JSONL),
    ]);
    const agent = new LLMAgent({ streamer, tools: [tool] });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 3);
    // 参数解析失败，工具本体不执行
    assert.equal(executions.length, 0);
  });

  it("调用了未注册的工具 → 错误结果回灌，继续回路", async () => {
    const { streamer } = scriptedStreamer([
      toolCallEvents(makeToolCall("ghostTool", { x: 1 })),
      textEvents(CANNED_JSONL),
    ]);
    const agent = new LLMAgent({ streamer, tools: [] });

    const lines = await collect(agent, { input: "x" });
    assert.equal(lines.length, 3);
  });

  it("模型持续调用工具超过轮数上限 → 抛错", async () => {
    const { tool } = countingTool();
    const { streamer } = scriptedStreamer([
      toolCallEvents(makeToolCall("countTool", { query: "x" })),
    ]);
    const agent = new LLMAgent({ streamer, tools: [tool] });
    await assert.rejects(
      collect(agent, { input: "x" }),
      /calling tools for 5 rounds/,
    );
  });
});

// ============ 多轮微调：协议由客户端随请求携带 ============

/** 以显式 currentProtocol 跑一轮 agent，收集返回的协议行 */
async function runAgent(
  agent: LLMAgent,
  options: { input: string; currentProtocol?: string; tag: string },
): Promise<{ lines: string[] }> {
  const lines: string[] = [];
  for await (const line of agent.run({
    input: options.input,
    currentProtocol: options.currentProtocol,
    threadId: `th-${options.tag}`,
    runId: `rn-${options.tag}`,
  })) {
    lines.push(line);
  }
  return { lines };
}

describe("LLMAgent 多轮微调（客户端携带协议）", () => {
  it("首轮：system + user 单文本 part，不含当前协议", async () => {
    const { streamer, calls } = scriptedStreamer([textEvents(CANNED_JSONL)]);
    const agent = new LLMAgent({ streamer, tools: [] });

    await runAgent(agent, { input: "build it", tag: "t1" });

    assert.equal(calls[0].messages.length, 2);
    assert.equal(calls[0].messages[0].role, "system");
    const user = calls[0].messages[1] as { content: ContentPart[] };
    assert.equal(Array.isArray(user.content), true);
    assert.equal(user.content.length, 1);
    assert.equal(user.content[0].type, "text");
    assert.equal((user.content[0] as { text: string }).text, "build it");
  });

  it("微调轮：user 含两个文本 part——先带当前协议与仅回增量的指令，再带微调请求", async () => {
    const { streamer, calls } = scriptedStreamer([textEvents(DELTA_JSONL)]);
    const agent = new LLMAgent({ streamer, tools: [] });

    await runAgent(agent, {
      input: "change title",
      currentProtocol: CANNED_JSONL,
      tag: "t2",
    });

    const sentMessages = calls[0].messages;
    // server 无状态：仍只有 system + user 两条
    assert.equal(sentMessages.length, 2);
    const user = sentMessages[1] as { content: ContentPart[] };
    assert.equal(user.content.length, 2);
    const contextPart = user.content[0] as { type: "text"; text: string };
    assert.equal(contextPart.type, "text");
    // 上下文中包含现有协议全文与"仅返回增量"指令
    assert.match(contextPart.text, /currently rendered/);
    assert.match(contextPart.text, /ONLY the minimal incremental/);
    assert.ok(contextPart.text.includes(CANNED_JSONL));
    // 第二个 part 为微调指令本身
    assert.deepEqual(user.content[1], {
      type: "text",
      text: "change title",
    });
  });

  it("server 不累积状态：同一线程连续调用且不传 currentProtocol，两次消息结构一致", async () => {
    const { streamer, calls } = scriptedStreamer([
      textEvents(CANNED_JSONL),
      textEvents(DELTA_JSONL),
    ]);
    const agent = new LLMAgent({ streamer, tools: [] });

    await runAgent(agent, { input: "first", tag: "same" });
    await runAgent(agent, { input: "second", tag: "same" });

    // 第二次调用不会自动带上首次内容（唯一来源是 currentProtocol）
    assert.equal(calls[0].messages.length, 2);
    assert.equal(calls[1].messages.length, 2);
    const user = calls[1].messages[1] as { content: ContentPart[] };
    assert.equal(user.content.length, 1);
    assert.equal((user.content[0] as { text: string }).text, "second");
  });

  it("微调轮模型先调用工具再返回增量：工具执行，最终产出增量 JSONL", async () => {
    const { tool, executions } = countingTool();
    const { streamer } = scriptedStreamer([
      toolCallEvents(makeToolCall("countTool", { query: "x" })),
      textEvents(DELTA_JSONL),
    ]);
    const agent = new LLMAgent({ streamer, tools: [tool] });

    const { lines } = await runAgent(agent, {
      input: "edit with tool",
      currentProtocol: CANNED_JSONL,
      tag: "t3",
    });

    // 工具被执行，最终仅返回增量消息
    assert.equal(executions.length, 1);
    assert.equal(lines.join("\n"), DELTA_JSONL);
  });
});

// ---- HTTP 集成：POST / 携带 base64 图片 → AG-UI 事件流 ----

let server: Server;
let baseUrl: string;

before(async () => {
  const { streamer } = scriptedStreamer([textEvents(CANNED_JSONL)]);
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
