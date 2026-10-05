/**
 * List 动态渲染 mock（v0.8 · children.template）
 *
 * 数据模型中一个 map 驱动整段列表，模板组件按 item 作用域做相对绑定：
 *
 *   1. dataModelUpdate path "/"：
 *        heading valueString "Project members"
 *        members valueMap：
 *          "0" -> valueMap { name: "Alice", role: "Admin" }
 *          "1" -> valueMap { name: "Bob",   role: "User" }
 *   2. surfaceUpdate：
 *        page        Column explicitList [heading, member_list]
 *        heading     Text path /heading
 *        member_list List vertical, children.template:
 *                      componentId "item_row", dataBinding "/members"
 *        item_row    Row alignment center, explicitList [item_name, item_role]
 *        item_name   Text path /name   ← 相对 item 作用域
 *        item_role   Text path /role   ← 相对 item 作用域
 *   3. beginRendering root page
 *
 * 随 members 数据变化，List 自动渲染对应数量的 item_row。
 * 整份加载与逐条推送使用同一数组。
 */
export const messages: string[] = [
  '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"heading","valueString":"Project members"},{"key":"members","valueMap":[{"key":"0","valueMap":[{"key":"name","valueString":"Alice"},{"key":"role","valueString":"Admin"}]},{"key":"1","valueMap":[{"key":"name","valueString":"Bob"},{"key":"role","valueString":"User"}]}]}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"page","component":{"Column":{"children":{"explicitList":["heading","member_list"]},"distribution":"start","alignment":"start"}}},{"id":"heading","component":{"Text":{"text":{"path":"/heading"},"usageHint":"h2"}}},{"id":"member_list","component":{"List":{"direction":"vertical","alignment":"start","children":{"template":{"componentId":"item_row","dataBinding":"/members"}}}}},{"id":"item_row","component":{"Row":{"alignment":"center","children":{"explicitList":["item_name","item_role"]}}}},{"id":"item_name","component":{"Text":{"text":{"path":"/name"}}}},{"id":"item_role","component":{"Text":{"text":{"path":"/role"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"page"}}',
];
