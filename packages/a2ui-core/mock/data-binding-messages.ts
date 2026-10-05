/**
 * 数据绑定极简 mock（v0.8 · parser / 数据协议 / 绑定）
 *
 * 用一份尽可能小的协议，把“数据协议 → parser → 绑定解析”整条链路串通：
 *
 *   1. dataModelUpdate path "/"（整模型替换）：
 *        - name  valueString  "Ada"
 *        - age   valueNumber  36
 *        - vip   valueBoolean true
 *        - addr  valueMap     { city: "London", zip: "SW1" }   ← 邻接表递归展开
 *   2. 一条 surfaceUpdate：Column + 4 个 Text，
 *      每个 Text 的 text 都是一个 path 绑定（含 valueMap 展开后的嵌套路径 /addr/city）
 *   3. beginRendering 指定根
 *
 * 不涉及交互组件，专供整体 parser 与数据绑定的端到端断言。
 * 整份加载与逐条推送使用同一数组。
 */
export const messages: string[] = [
  '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"name","valueString":"Ada"},{"key":"age","valueNumber":36},{"key":"vip","valueBoolean":true},{"key":"addr","valueMap":[{"key":"city","valueString":"London"},{"key":"zip","valueString":"SW1"}]}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["t-name","t-age","t-vip","t-city"]},"distribution":"start","alignment":"start"}}},{"id":"t-name","component":{"Text":{"text":{"path":"/name"}}}},{"id":"t-age","component":{"Text":{"text":{"path":"/age"}}}},{"id":"t-vip","component":{"Text":{"text":{"path":"/vip"}}}},{"id":"t-city","component":{"Text":{"text":{"path":"/addr/city"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"root"}}',
];
