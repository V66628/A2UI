/**
 * JSON stream 缓冲区（JSONL 成帧）
 *
 * 真实 stream（SSE / WebSocket / fetch reader）到达的是任意长度字符分片：
 * 一条 JSON 消息可能被切成多段，一个分片也可能同时含多条消息。
 * 本模块按「大括号配平」从缓冲中切出完整 JSON 对象——正确处理字符串内
 * 括号与转义，不依赖换行即可成帧；帧间空白 / 换行自动跳过。
 */

export interface ExtractedFrames {
  /** 已完整的 JSON 消息原文 */
  frames: string[];
  /** 尚未成帧的滞留分片（下一分片到来后继续拼接） */
  rest: string;
}

/**
 * 从缓冲区中提取全部完整 JSON 对象（纯函数）。
 *
 * 扫描时跟踪：
 * - 字符串上下文（"..." 内的括号不计数，\" \\ 等转义正确穿透）；
 * - 大括号深度：深度归 0 即一条完整消息；
 * 对象之外的空白与换行忽略。深度未归 0 的尾部作为 rest 原样返回。
 */
export function extractCompleteJson(buffer: string): ExtractedFrames {
  const frames: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let frameStart = -1;

  for (let i = 0; i < buffer.length; i += 1) {
    const ch = buffer[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) frameStart = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && frameStart >= 0) {
        frames.push(buffer.slice(frameStart, i + 1));
        frameStart = -1;
      }
    }
  }

  const rest = frameStart >= 0 ? buffer.slice(frameStart) : "";
  return { frames, rest };
}

/**
 * 将一条完整 A2UI 消息归一化为可逐条 parse 的 JSONL：
 * surfaceUpdate 中的每个 component 拆为独立 surfaceUpdate（同 surfaceId）；
 * 其余消息原样返回。
 *
 * 拆分后每条消息都是「单动作键 + 单组件」的完整 JSONL，可直接送 parser；
 * 非法 JSON 原样返回（交由 parser 记 PARSE_ERROR，不静默丢弃）。
 */
export function normalizeMessageFrames(rawJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [rawJson];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [rawJson];
  }
  const update = (parsed as { surfaceUpdate?: unknown }).surfaceUpdate;
  if (
    typeof update !== "object" ||
    update === null ||
    !Array.isArray((update as { components?: unknown }).components)
  ) {
    return [rawJson];
  }

  const { surfaceId, components } = update as {
    surfaceId: unknown;
    components: unknown[];
  };
  if (components.length <= 1) return [rawJson];

  return components.map(
    (component) =>
      JSON.stringify({
        surfaceUpdate: { surfaceId, components: [component] },
      }),
  );
}

/**
 * 有状态的 JSON stream 缓冲区：
 * 持续 push 字符分片，返回每次已就绪、可直接送 parser 的完整 JSONL
 * （surfaceUpdate 已按 component 拆分为独立消息）。
 */
export interface JsonStreamBuffer {
  /** 接收一个字符分片，返回本次成帧并归一化后的完整 JSONL 行 */
  push(chunk: string): string[];
  /** 是否有未完成帧滞留（连接结束仍为 true 说明输入残缺） */
  hasPending(): boolean;
  /** 清空滞留分片 */
  reset(): void;
}

/** 创建 JSON stream 缓冲区 */
export function createJsonStreamBuffer(): JsonStreamBuffer {
  let pending = "";

  return {
    push(chunk) {
      pending += chunk;
      const { frames, rest } = extractCompleteJson(pending);
      pending = rest;
      const ready: string[] = [];
      for (const frame of frames) {
        ready.push(...normalizeMessageFrames(frame));
      }
      return ready;
    },
    hasPending: () => pending.length > 0,
    reset() {
      pending = "";
    },
  };
}
