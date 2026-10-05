/**
 * 简单购物车列表 mock（v0.8 · children.template 数据驱动）
 *
 * 仅使用当前 renderer 支持的标准组件：Text / Row / Column / List / Button。
 *
 *   1. dataModelUpdate path "/"：
 *        title valueString "Shopping Cart"
 *        items valueMap（3 个商品）：
 *          "0" -> { name: "Mechanical Keyboard", price: "$89.00", qty: 1 }
 *          "1" -> { name: "Wireless Mouse",     price: "$25.50", qty: 2 }
 *          "2" -> { name: "USB-C Cable",        price: "$9.90",  qty: 1 }
 *        total valueString "$149.90"
 *   2. surfaceUpdate：
 *        page            Column：title / cart_list / total_row / checkout_button
 *        cart_title      Text literal "Shopping Cart"（h2）
 *        cart_list       List vertical，children.template:
 *                          componentId "item_row", dataBinding "/items"
 *        item_row        Row spaceBetween/center：名称 / 单价 / 数量 / Remove
 *        item_name       Text path /name     ← 相对 item 作用域
 *        item_price      Text path /price
 *        item_qty        Text path /qty
 *        remove_button   Button，action remove_item，context 携带 /name
 *        total_row       Row spaceBetween："Total" + /total
 *        checkout_button Button primary，action checkout
 *   3. beginRendering root page
 *
 * 整份加载与逐条推送使用同一数组；playground 经 glob 自动加载本 mock。
 */
export const messages: string[] = [
  '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"title","valueString":"Shopping Cart"},{"key":"items","valueMap":[{"key":"0","valueMap":[{"key":"name","valueString":"Mechanical Keyboard"},{"key":"price","valueString":"$89.00"},{"key":"qty","valueNumber":1}]},{"key":"1","valueMap":[{"key":"name","valueString":"Wireless Mouse"},{"key":"price","valueString":"$25.50"},{"key":"qty","valueNumber":2}]},{"key":"2","valueMap":[{"key":"name","valueString":"USB-C Cable"},{"key":"price","valueString":"$9.90"},{"key":"qty","valueNumber":1}]}]},{"key":"total","valueString":"$149.90"}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"page","component":{"Column":{"children":{"explicitList":["cart_title","cart_list","total_row","checkout_button"]},"distribution":"start","alignment":"stretch"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"cart_title","component":{"Text":{"text":{"literalString":"Shopping Cart"},"usageHint":"h2"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"cart_list","component":{"List":{"direction":"vertical","alignment":"stretch","children":{"template":{"componentId":"item_row","dataBinding":"/items"}}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"item_row","component":{"Row":{"distribution":"spaceBetween","alignment":"center","children":{"explicitList":["item_name","item_price","item_qty","remove_button"]}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"item_name","component":{"Text":{"text":{"path":"/name"}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"item_price","component":{"Text":{"text":{"path":"/price"}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"item_qty","component":{"Text":{"text":{"path":"/qty"},"usageHint":"caption"}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"remove_button","component":{"Button":{"child":"remove_label","action":{"name":"remove_item","context":[{"key":"name","value":{"path":"/name"}}]}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"remove_label","component":{"Text":{"text":{"literalString":"Remove"}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"total_row","component":{"Row":{"distribution":"spaceBetween","alignment":"center","children":{"explicitList":["total_label","total_value"]}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"total_label","component":{"Text":{"text":{"literalString":"Total"}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"total_value","component":{"Text":{"text":{"path":"/total"}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"checkout_button","component":{"Button":{"child":"checkout_label","primary":true,"action":{"name":"checkout"}}}}]}}',
  '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"checkout_label","component":{"Text":{"text":{"literalString":"Checkout"}}}}]}}',
  '{"beginRendering":{"surfaceId":"main","root":"page"}}',
];
