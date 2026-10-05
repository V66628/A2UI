import assert from "node:assert";
import {
  extractTemplate,
  parseProtocol,
  type RenderContext,
  type RenderMap,
  type TemplateChild,
} from "../../src/parser/index.js";
import { createParser } from "../../src/parser/index.js";
import { setRenderMap } from "../../src/parser/render-registry.js";
import { buildTree } from "../../src/treebuilder/index.js";
import { messages as listMessages } from "../../mock/list-messages.js";

/** 测试 vnode */
interface TestVNode {
  kind: string;
  context: RenderContext;
  /** List：动态子项的即刻解析结果 */
  items?: TemplateChild[];
  /** Row：explicit 子项的即刻解析结果 */
  childVnodes?: unknown[];
}

/**
 * 测试用 renderMap：与 a2ui-react 的适配器同构：
 * List 即刻 resolveTemplate（生产环境惰性），Row 即刻解析 explicit 子项。
 */
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
};

const fullJsonl = listMessages.join("\n");

function listNodeOf(result: ReturnType<typeof parseProtocol>): TestVNode {
  const node = result.hydrateNodes.find(
    (item) => item.componentId === "member_list",
  );
  assert.ok(node);
  return node!._vnode as TestVNode;
}

/**
 * 取 scoped Text context：List.items → 每个 scoped Row →
 * 其 childVnodes（scoped item_name/item_role，与 explicitList 顺序一致）。
 * 不能读 hydrateNodes 中 item_name/item_role 节点的最终 _vnode——
 * rerenderAllNodes 会用 surface 根作用域渲染覆盖它们。
 */
function scopedTextContexts(
  result: ReturnType<typeof parseProtocol>,
): RenderContext[] {
  const items = listNodeOf(result).items ?? [];
  return items.flatMap((item) =>
    ((item.vnode as TestVNode).childVnodes ?? []).map(
      (child) => (child as TestVNode).context,
    ),
  );
}

describe("List 动态渲染端到端（list mock）", () => {
  beforeEach(() => {
    setRenderMap(testRenderMap);
  });

  afterEach(() => setRenderMap(null));

  it("应解析 1 个 surface、6 个节点、0 错误且 beginRender=true", () => {
    const result = parseProtocol(fullJsonl);
    assert.strictEqual(result.surfaces.length, 1);
    assert.strictEqual(result.hydrateNodes.length, 6);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.surfaces[0].beginRender, true);
  });

  it("List 应按 members 的 2 个 key 渲染 2 个 item，key 为 0/1", () => {
    const result = parseProtocol(fullJsonl);
    const items = listNodeOf(result).items ?? [];
    assert.strictEqual(items.length, 2);
    assert.deepStrictEqual(
      items.map((item) => item.key),
      ["0", "1"],
    );
  });

  it("item 内 Text 应以 item 为作用域相对解析：Alice/Admin、Bob/User", () => {
    const result = parseProtocol(fullJsonl);
    const contexts = scopedTextContexts(result);
    // 4 个 scoped Text（每 item 的 name + role），其 dataModel 是对应 item
    const scopedModels = contexts.map((ctx) => ctx.dataModel);
    assert.deepStrictEqual(scopedModels, [
      { name: "Alice", role: "Admin" },
      { name: "Alice", role: "Admin" },
      { name: "Bob", role: "User" },
      { name: "Bob", role: "User" },
    ]);
  });

  it("scoped writeDataModel 应映射为 surface 绝对路径 /members/0/name 并写入", () => {
    const parser = createParser();
    for (const line of listMessages) parser.parse(line);

    // 经 List.items[0]（scoped Row）取第一个子项 item_name 的 scoped context
    const firstRow = listNodeOf(parser.getResult()).items?.[0]
      .vnode as TestVNode;
    const nameContext = (firstRow.childVnodes?.[0] as TestVNode).context;

    // 相对写 "/name" → 绝对 "/members/0/name"
    nameContext.writeDataModel?.("/name", "Carol");

    const members = parser.getResult().surfaces[0].dataModel?.members as Record<
      string,
      { name: string }
    >;
    assert.strictEqual(members[0].name, "Carol");
    // 其他 item 不受影响
    assert.strictEqual(members[1].name, "Bob");
  });

  it("逐条推送与整份解析的最终结果一致", () => {
    const parser = createParser();
    for (const line of listMessages) parser.parse(line);
    const streamed = parser.getResult();
    const whole = parseProtocol(fullJsonl);

    assert.deepStrictEqual(
      streamed.surfaces[0].dataModel,
      whole.surfaces[0].dataModel,
    );
    assert.strictEqual(streamed.errors.length, 0);
    assert.strictEqual(
      listNodeOf(streamed).items?.length,
      listNodeOf(whole).items?.length,
    );
  });

  it("treebuilder：List 的结构子节点应为模板组件 item_row", () => {
    const result = parseProtocol(fullJsonl);
    const tree = buildTree(result.hydrateNodes, "page", "main");
    // page → ... → member_list → item_row（模板代表节点）
    const findInTree = (
      componentId: string,
      node: typeof tree.root,
    ): typeof tree.root => {
      if (node?.node.componentId === componentId) return node;
      for (const child of node?.children ?? []) {
        const found = findInTree(componentId, child);
        if (found) return found;
      }
      return null;
    };

    const listTreeNode = findInTree("member_list", tree.root);
    assert.ok(listTreeNode, "member_list 应在树中");
    assert.strictEqual(listTreeNode!.children.length, 1);
    assert.strictEqual(listTreeNode!.children[0].node.componentId, "item_row");
  });
});
