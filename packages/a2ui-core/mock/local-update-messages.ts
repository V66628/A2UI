/**
 * 本地更新最小 case mock（v0.8 扩展 · action.localUpdate）
 *
 * 不经过 server：点击按钮在本地模拟 dataModelUpdate，更新一行文案。
 *
 *   1. dataModelUpdate path "/"：message valueString "Before click"
 *   2. surfaceUpdate：
 *        root          Column stretch：message_text / update_button
 *        message_text  Text path /message        ← 文案由 dataModel 驱动
 *        update_button Button，action:
 *          name "update_message"
 *          localUpdate { path: "/message",
 *                        value: { literalString: "After click: updated locally" } }
 *   3. beginRendering root root
 *
 * 点击按钮：client 解析 localUpdate.value，本地深写 /message，
 * 不派发 userAction，parser 自动以最新模型重渲染。
 */
export const messages: string[] = [
  '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"message","valueString":"Before click"}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["message_text","update_button"]},"distribution":"start","alignment":"stretch"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"message_text","component":{"Text":{"text":{"path":"/message"}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"update_button","component":{"Button":{"child":"update_label","action":{"name":"update_message","localUpdate":{"path":"/message","value":{"literalString":"After click: updated locally"}}}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"update_label","component":{"Text":{"text":{"literalString":"Update text"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"root"}}',
];
