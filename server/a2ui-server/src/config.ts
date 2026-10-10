import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 极简 .env 加载（不引入 dotenv 依赖）：
 * 仅在启动时执行一次；已存在于 process.env 的变量不覆盖。
 */
export function loadEnvFile(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(__dirname, "..", ".env"),
  ];
  const path = candidates.find((item) => existsSync(item));
  if (!path) return;

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

// 模块加载即执行：保证 import 本模块的其他文件（在 CommonJS 下
// require 先于启动代码执行）读到的 process.env 已包含 .env
loadEnvFile();

/** LLM（OpenAI 兼容 / oneapi）连接配置，来自 .env */
export const llmConfig = {
  baseURL: process.env.BASE_URL ?? "",
  apiKey: process.env.API_KEY ?? "",
  /** 默认文本模型；可用 MODEL 覆盖 */
  model: process.env.MODEL ?? "qwen3.8-flash",
  /** 多模态（图片输入）默认视觉模型；可用 VISION_MODEL 覆盖 */
  visionModel: process.env.VISION_MODEL ?? "qwen3-vl-flash",
  /**
   * 单次生成的最大 token 数；可用 MAX_TOKENS 覆盖。
   * reasoning 模型（如 qwen3.8-flash）默认 max_tokens 会被推理内容占用、
   * 导致正文 JSONL 被截断，因此显式给足。
   */
  maxTokens: Number(process.env.MAX_TOKENS ?? 16384),
};
