/**
 * Column / Row 多级嵌套 mock（v0.8）
 *
 * 每条消息只定义一个组件，按依赖拓扑顺序排列（父容器先于子组件）：
 *
 *   page (Column)
 *   ├── header (Row, spaceBetween)
 *   │   ├── title "Row / Column 混排页面" (h1)
 *   │   └── badge "v0.8" (caption)
 *   └── body (Column)
 *       ├── row-1 (Row, spaceAround): 第一行 - 甲/乙/丙
 *       ├── row-2 (Row, spaceAround): 第二行 - 丁/戊/己
 *       └── actions (Row, end): 取消 / 确定
 *
 * 共 16 个组件（2 Column + 4 Row + 10 Text）+ 1 条 beginRendering。
 * 整份加载与逐条推送使用同一数组。
 */
export const messages: string[] = [
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"page","component":{"Column":{"children":{"explicitList":["header","body"]},"distribution":"start","alignment":"stretch"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"header","component":{"Row":{"children":{"explicitList":["title","badge"]},"distribution":"spaceBetween","alignment":"center"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"title","component":{"Text":{"text":{"literalString":"Row / Column 混排页面"},"usageHint":"h1"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"badge","component":{"Text":{"text":{"literalString":"v0.8"},"usageHint":"caption"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"body","component":{"Column":{"children":{"explicitList":["row-1","row-2","actions"]},"distribution":"start","alignment":"stretch"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"row-1","component":{"Row":{"children":{"explicitList":["f1","f2","f3"]},"distribution":"spaceAround","alignment":"center"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"f1","component":{"Text":{"text":{"literalString":"第一行 - 甲"},"usageHint":"body"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"f2","component":{"Text":{"text":{"literalString":"第一行 - 乙"},"usageHint":"body"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"f3","component":{"Text":{"text":{"literalString":"第一行 - 丙"},"usageHint":"body"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"row-2","component":{"Row":{"children":{"explicitList":["f4","f5","f6"]},"distribution":"spaceAround","alignment":"center"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"f4","component":{"Text":{"text":{"literalString":"第二行 - 丁"},"usageHint":"body"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"f5","component":{"Text":{"text":{"literalString":"第二行 - 戊"},"usageHint":"body"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"f6","component":{"Text":{"text":{"literalString":"第二行 - 己"},"usageHint":"body"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"actions","component":{"Row":{"children":{"explicitList":["cancel","ok"]},"distribution":"end","alignment":"center"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"cancel","component":{"Text":{"text":{"literalString":"取消"},"usageHint":"body"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"ok","component":{"Text":{"text":{"literalString":"确定"},"usageHint":"body"}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"page"}}',
];
