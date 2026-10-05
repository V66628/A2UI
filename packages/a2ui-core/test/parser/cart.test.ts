import assert from "node:assert";
import {
  createParser,
  extractTemplate,
  parseProtocol,
  type RenderContext,
  type RenderMap,
  type TemplateChild,
} from "../../src/parser/index.js";
import { setRenderMap } from "../../src/parser/render-registry.js";
import { buildTree } from "../../src/treebuilder/index.js";
import { messages as cartMessages } from "../../mock/cart-messages.js";

/** 测试 vnode */
interface TestVNode {
  kind: string;
  context: RenderContext;
  /** List：动态子项即刻解析 */
  items?: TemplateChild[];
  /** Row：explicit 子项即刻解析 */
  childVnodes?: unknown[];
}

/** 与 a2ui-react 适配器同构的测试 renderMap */
const testRenderMap: RenderMap = {
  Text: (_props, context) => ({ kind: "Text", context }) as TestVNode as never,
  Row: (props, context) => {
    const ids =
      (props as { children?: { explicitList?: string[] } }).children
        ?.explicitList ?? [];
    return {
      kind: "Row",
      context,
      childVnodes: ids.map((id) => context.resolveNode?.(id)?._vnode ?? null),
    } as TestVNode as never;
  },
  Column: (_props, context) =>
    ({ kind: "Column", context }) as TestVNode as never,
  List: (props, context) => {
    const template = extractTemplate(props);
    return {
      kind: "List",
      context,
      items: template ? (context.resolveTemplate?.(template) ?? []) : [],
    } as TestVNode as never;
  },
  Button: (_props, context) =>
    ({ kind: "Button", context }) as TestVNode as never,
};

const fullJsonl = cartMessages.join("\n");

/** page(Column) → cart_list(List) */
function cartListNode(result: ReturnType<typeof parseProtocol>): TestVNode {
  const tree = buildTree(result.hydrateNodes, "page", "main");
  assert.ok(tree.root);
  const listHydrate = result.hydrateNodes.find(
    (node) => node.componentId === "cart_list",
  );
  assert.ok(listHydrate);
  return listHydrate!._vnode as TestVNode;
}

/** 取每个 item Row 的前 3 个 Text（name / price / qty）scoped context */
function itemTextContexts(
  result: ReturnType<typeof parseProtocol>,
): RenderContext[] {
  const items = cartListNode(result).items ?? [];
  return items.flatMap((item) =>
    ((item.vnode as TestVNode).childVnodes ?? [])
      .slice(0, 3)
      .map((child) => (child as TestVNode).context),
  );
}

describe("购物车列表（cart mock）", () => {
  beforeEach(() => setRenderMap(testRenderMap));
  afterEach(() => setRenderMap(null));

  it("应解析 1 个 surface、14 个组件节点、0 错误且 beginRender=true", () => {
    const result = parseProtocol(fullJsonl);
    assert.strictEqual(result.surfaces.length, 1);
    assert.strictEqual(result.hydrateNodes.length, 14);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.surfaces[0].beginRender, true);
  });

  it("List 应按 /items 的 3 个 key 渲染 3 个商品行，key 为 0/1/2", () => {
    const result = parseProtocol(fullJsonl);
    const items = cartListNode(result).items ?? [];
    assert.strictEqual(items.length, 3);
    assert.deepStrictEqual(
      items.map((item) => item.key),
      ["0", "1", "2"],
    );
  });

  it("每行 Text 应以 item 为作用域相对解析 name/price/qty", () => {
    const result = parseProtocol(fullJsonl);
    const models = itemTextContexts(result).map((ctx) => ctx.dataModel);
    assert.deepStrictEqual(models, [
      { name: "Mechanical Keyboard", price: "$89.00", qty: 1 },
      { name: "Mechanical Keyboard", price: "$89.00", qty: 1 },
      { name: "Mechanical Keyboard", price: "$89.00", qty: 1 },
      { name: "Wireless Mouse", price: "$25.50", qty: 2 },
      { name: "Wireless Mouse", price: "$25.50", qty: 2 },
      { name: "Wireless Mouse", price: "$25.50", qty: 2 },
      { name: "USB-C Cable", price: "$9.90", qty: 1 },
      { name: "USB-C Cable", price: "$9.90", qty: 1 },
      { name: "USB-C Cable", price: "$9.90", qty: 1 },
    ]);
  });

  it("数据模型应含 title/total 与 3 个商品", () => {
    const result = parseProtocol(fullJsonl);
    const model = result.surfaces[0].dataModel as {
      title: string;
      total: string;
      items: Record<string, { name: string }>;
    };
    assert.strictEqual(model.title, "Shopping Cart");
    assert.strictEqual(model.total, "$149.90");
    assert.strictEqual(Object.keys(model.items).length, 3);
  });

  it("逐条推送与整份解析的最终结果一致", () => {
    const parser = createParser();
    for (const line of cartMessages) parser.parse(line);
    const streamed = parser.getResult();
    const whole = parseProtocol(fullJsonl);

    assert.strictEqual(streamed.errors.length, 0);
    assert.deepStrictEqual(
      streamed.surfaces[0].dataModel,
      whole.surfaces[0].dataModel,
    );
    assert.strictEqual(
      cartListNode(streamed).items?.length,
      cartListNode(whole).items?.length,
    );
  });

  it("后续 dataModelUpdate（移除 1 个商品 + 更新合计）应动态重渲染为 2 行", () => {
    const parser = createParser();
    for (const line of cartMessages) parser.parse(line);
    assert.strictEqual(cartListNode(parser.getResult()).items?.length, 3);

    // 模拟服务端推送：path "/" 整替换，只剩 2 个商品，合计更新
    parser.parse(
      '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"items","valueMap":[{"key":"0","valueMap":[{"key":"name","valueString":"Wireless Mouse"},{"key":"price","valueString":"$25.50"},{"key":"qty","valueNumber":2}]},{"key":"1","valueMap":[{"key":"name","valueString":"USB-C Cable"},{"key":"price","valueString":"$9.90"},{"key":"qty","valueNumber":1}]}]},{"key":"total","valueString":"$60.90"}]}}',
    );

    const updated = parser.getResult();
    const items = cartListNode(updated).items ?? [];
    assert.strictEqual(items.length, 2);
    assert.deepStrictEqual(
      items.map((item) => item.key),
      ["0", "1"],
    );
    // 行内作用域数据随新模型变化
    assert.deepStrictEqual(
      itemTextContexts(updated)
        .slice(0, 3)
        .map((ctx) => ctx.dataModel),
      [
        { name: "Wireless Mouse", price: "$25.50", qty: 2 },
        { name: "Wireless Mouse", price: "$25.50", qty: 2 },
        { name: "Wireless Mouse", price: "$25.50", qty: 2 },
      ],
    );
    assert.strictEqual(updated.surfaces[0].dataModel?.total, "$60.90");
  });

  it("嵌套 dataModelUpdate 深写新增 1 个商品后应动态增加为 4 行", () => {
    const parser = createParser();
    for (const line of cartMessages) parser.parse(line);

    // path /items 合并新 key "3"（中间深写合并，已有 0/1/2 保留）
    parser.parse(
      '{"dataModelUpdate":{"surfaceId":"main","path":"/items","contents":[{"key":"3","valueMap":[{"key":"name","valueString":"Laptop Stand"},{"key":"price","valueString":"$19.00"},{"key":"qty","valueNumber":1}]}]}}',
    );

    const items = cartListNode(parser.getResult()).items ?? [];
    assert.strictEqual(items.length, 4);
    const lastRowVnode = (items[3].vnode as TestVNode).childVnodes?.[0] as
      | TestVNode
      | undefined;
    assert.ok(lastRowVnode);
    assert.strictEqual(lastRowVnode!.context.dataModel?.name, "Laptop Stand");
  });

  it("treebuilder：cart_list 的结构子节点应为模板 item_row，且根为 page", () => {
    const result = parseProtocol(fullJsonl);
    const tree = buildTree(result.hydrateNodes, "page", "main");
    assert.strictEqual(tree.root?.node.componentId, "page");

    // 从根递归找 cart_list 节点
    const findNode = (
      componentId: string,
      node: typeof tree.root,
    ): NonNullable<typeof tree.root> | null => {
      if (node?.node.componentId === componentId) return node;
      for (const child of node?.children ?? []) {
        const found = findNode(componentId, child);
        if (found) return found;
      }
      return null;
    };

    const listTreeNode = findNode("cart_list", tree.root);
    assert.ok(listTreeNode, "cart_list 应在树中");
    assert.strictEqual(listTreeNode!.children.length, 1);
    assert.strictEqual(listTreeNode!.children[0].node.componentId, "item_row");
  });
});
