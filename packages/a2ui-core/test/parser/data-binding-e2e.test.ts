import assert from "node:assert";
import {
  parseProtocol,
  resolveBinding,
  type RenderContext,
  type RenderMap,
} from "../../src/parser/index.js";
import { createParser } from "../../src/parser/index.js";
import {
  setRenderMap,
  setTreeRenderer,
} from "../../src/parser/render-registry.js";
import { messages as bindingMessages } from "../../mock/data-binding-messages.js";

/** 测试 vnode：记录组件类型与绑定解析结果 */
interface TestVNode {
  kind: "Text" | "Column";
  /** Text：经绑定解析出的最终显示值 */
  value?: unknown;
  /** Column：子组件 id 引用 */
  childIds?: string[];
  context: RenderContext;
}

/**
 * 测试用 renderMap，Text 与 a2ui-react 的 Text 适配器走同一条解析路径：
 * 用 resolveBinding 解析 text 绑定（字面量 / path）。
 */
const testRenderMap: RenderMap = {
  Text: (props, context) => {
    const textProps = props as { text?: { literalString?: string; path?: string } };
    return {
      kind: "Text",
      value: resolveBinding(textProps.text, context.dataModel),
      context,
    } as TestVNode as never;
  },
  Column: (props, context) => {
    const colProps = props as { children?: { explicitList?: string[] } };
    return {
      kind: "Column",
      childIds: colProps.children?.explicitList ?? [],
      context,
    } as TestVNode as never;
  },
};

const fullJsonl = bindingMessages.join("\n");

/** 按 componentId 取测试 vnode */
function vnodeOf(result: ReturnType<typeof parseProtocol>, id: string): TestVNode {
  const node = result.hydrateNodes.find((item) => item.componentId === id);
  assert.ok(node, `节点 ${id} 应存在`);
  return node!._vnode as TestVNode;
}

describe("整体 parser + 数据协议 + 绑定（data-binding 极简协议）", () => {
  beforeEach(() => {
    setRenderMap(testRenderMap);
    setTreeRenderer(null);
  });

  afterEach(() => {
    setRenderMap(null);
    setTreeRenderer(null);
  });

  describe("数据协议：dataModelUpdate 写入数据模型", () => {
    it("path '/' 应整模型替换，展开全部 typed value（含 valueMap 嵌套）", () => {
      const result = parseProtocol(fullJsonl);
      const model = result.surfaces[0].dataModel;
      assert.deepStrictEqual(model, {
        name: "Ada",
        age: 36,
        vip: true,
        addr: { city: "London", zip: "SW1" },
      });
    });

    it("valueMap 邻接表应递归展开为对象，可按嵌套路径取值", () => {
      const result = parseProtocol(fullJsonl);
      const addr = result.surfaces[0].dataModel?.addr as Record<string, unknown>;
      assert.strictEqual(addr.city, "London");
      assert.strictEqual(addr.zip, "SW1");
    });
  });

  describe("绑定解析：path 绑定从数据模型取值", () => {
    it("字符串 / 数字 / 布尔绑定应解析为模型中的原值（保留类型）", () => {
      const result = parseProtocol(fullJsonl);
      assert.strictEqual(vnodeOf(result, "t-name").value, "Ada");
      assert.strictEqual(vnodeOf(result, "t-age").value, 36);
      assert.strictEqual(vnodeOf(result, "t-vip").value, true);
    });

    it("嵌套路径绑定 /addr/city 应取到 valueMap 展开后的深层值", () => {
      const result = parseProtocol(fullJsonl);
      assert.strictEqual(vnodeOf(result, "t-city").value, "London");
    });

    it("每个节点 RenderContext.dataModel 应是同一份数据模型", () => {
      const result = parseProtocol(fullJsonl);
      const model = result.surfaces[0].dataModel;
      for (const id of ["t-name", "t-age", "t-vip", "t-city"]) {
        assert.strictEqual(vnodeOf(result, id).context.dataModel, model);
      }
    });
  });

  describe("整体结构：surface / 组件树 / 错误", () => {
    it("应解析 1 个 surface、5 个节点（1 Column + 4 Text）且 beginRender=true", () => {
      const result = parseProtocol(fullJsonl);
      assert.strictEqual(result.surfaces.length, 1);
      assert.strictEqual(result.hydrateNodes.length, 5);
      assert.strictEqual(result.surfaces[0].beginRender, true);
    });

    it("组件树根应为 root（Column），其显式子项含 4 个 Text id", () => {
      const result = parseProtocol(fullJsonl);
      const root = result.trees[0].root;
      assert.strictEqual(root?.node.componentId, "root");
      assert.deepStrictEqual(vnodeOf(result, "root").childIds, [
        "t-name",
        "t-age",
        "t-vip",
        "t-city",
      ]);
    });

    it("合法协议不应产生任何错误", () => {
      const result = parseProtocol(fullJsonl);
      assert.strictEqual(result.errors.length, 0);
    });
  });

  describe("有状态 parser 逐条推送（模拟流式）", () => {
    it("逐条 parse 与整份 parse 的最终数据模型、绑定结果一致", () => {
      const parser = createParser();
      for (const line of bindingMessages) parser.parse(line);
      const streamed = parser.getResult();
      const whole = parseProtocol(fullJsonl);

      assert.deepStrictEqual(
        streamed.surfaces[0].dataModel,
        whole.surfaces[0].dataModel,
      );
      for (const id of ["t-name", "t-age", "t-vip", "t-city"]) {
        assert.strictEqual(vnodeOf(streamed, id).value, vnodeOf(whole, id).value);
      }
      assert.strictEqual(streamed.errors.length, 0);
    });

    it("数据先于组件到达：仅 dataModelUpdate 时模型已就绪、节点数为 0", () => {
      const parser = createParser();
      parser.parse(bindingMessages[0]);
      const partial = parser.getResult();
      assert.strictEqual(partial.hydrateNodes.length, 0);
      assert.deepStrictEqual(partial.surfaces[0].dataModel, {
        name: "Ada",
        age: 36,
        vip: true,
        addr: { city: "London", zip: "SW1" },
      });
    });

    it("组件到达后绑定能正确解析此前已缓冲的数据模型", () => {
      const parser = createParser();
      parser.parse(bindingMessages[0]);
      parser.parse(bindingMessages[1]);
      const result = parser.getResult();
      assert.strictEqual(vnodeOf(result, "t-name").value, "Ada");
      assert.strictEqual(vnodeOf(result, "t-city").value, "London");
    });
  });
});
