import { LLMAgent } from "./agent/llm-agent";
import { MockAgent } from "./agent/mock-agent";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);

// AGENT=llm 时使用真实多模态模型生成 A2UI（自然语言 + 图片）；
// 缺省使用本地 MockAgent。
const useLlmAgent = process.env.AGENT === "llm";
const agent = useLlmAgent ? new LLMAgent() : new MockAgent();

const server = createApp(agent).listen(port, () => {
  console.log(`a2ui-server listening on http://localhost:${port}`);
  console.log(`  agent: ${useLlmAgent ? "LLM (multimodal)" : "mock"}`);
  console.log(`  GET  /health`);
  console.log(`  POST /       (input → AG-UI over SSE → A2UI protocol stream)`);
  console.log(
    `  POST /chat   (model chat over SSE, OpenAI-compatible / oneapi)`,
  );
});

// 优雅退出
const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
