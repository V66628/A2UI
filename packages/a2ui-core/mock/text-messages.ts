/**
 * Text mock（v0.8）
 *
 * 以 TS 模块定义 A2UI 消息数组：每个元素是一条 JSONL 消息（单行 JSON 字符串）。
 * 既可整体 join('\n') 交给 parser，也可逐条 parse 模拟流式推送。
 */
export const messages: string[] = [
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Text":{"text":{"literalString":"Hello A2UI"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"root"}}',
];
