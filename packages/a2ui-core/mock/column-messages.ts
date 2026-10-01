/**
 * Column mock（v0.8）
 *
 * 1 个 Column 容器 + 3 个 Text 子组件：
 * 一条 surfaceUpdate 批量定义全部组件，随后 beginRendering 指定根节点。
 */
export const messages: string[] = [
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"col-1","component":{"Column":{"children":{"explicitList":["text-1","text-2","text-3"]},"distribution":"start","alignment":"start"}}},{"id":"text-1","component":{"Text":{"text":{"literalString":"第一行文本"},"usageHint":"body"}}},{"id":"text-2","component":{"Text":{"text":{"literalString":"第二行文本"},"usageHint":"body"}}},{"id":"text-3","component":{"Text":{"text":{"literalString":"第三行文本"},"usageHint":"body"}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"col-1"}}',
];
