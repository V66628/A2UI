import assert from "node:assert";
import {
  createNodeToken,
  createParseContext,
  ensureSurface,
  upsertHydrateNode,
} from "../../src/parser/context.js";
import {
  extractTemplate,
  renderTemplateChildren,
} from "../../src/parser/template.js";
import { setRenderMap } from "../../src/parser/render-registry.js";
import type { RenderContext, RenderMap } from "../../src/parser/index.js";

/** 模板 Text 节点的协议原文（绑定 path /n，相对 item 作用域） */
function textTemplateLine(id: string, path = "/n"): string {
  return JSON.stringify({
    surfaceUpdate: {
      surfaceId: "s",
      components: [
        { id, component: { Text: { text: { path } } } },
      ],
    },
  });
}

/** 捕获 context 的测试 Text 渲染 */
const capturingTextMap: RenderMap = {
  Text: (_props, context) => ({ context }) as { context: RenderContext } as never,
};

describe("children.template 纯逻辑", () => {
  afterEach(() => setRenderMap(null));

  describe("extractTemplate", () => {
    it("应提取完整 template（componentId + dataBinding）", () => {
      assert.deepStrictEqual(
        extractTemplate({
          children: { template: { componentId: "t", dataBinding: "/arr" } },
        }),
        { componentId: "t", dataBinding: "/arr" },
      );
    });

    it("缺字段 / 类型错误 / 无 template 时应返回 undefined", () => {
      assert.strictEqual(extractTemplate({ children: {} }), undefined);
      assert.strictEqual(
        extractTemplate({
          children: { template: { componentId: "t" } },
        }),
        undefined,
      );
      assert.strictEqual(
        extractTemplate({
          children: { template: { componentId: 1, dataBinding: "/a" } },
        }),
        undefined,
      );
      assert.strictEqual(extractTemplate({}), undefined);
      assert.strictEqual(extractTemplate(null), undefined);
    });
  });

  describe("renderTemplateChildren", () => {
    it("绑定处为数组时应按下标迭代，每个 item 一个作用域渲染", () => {
      setRenderMap(capturingTextMap);
      const ctx = createParseContext();
      const surface = ensureSurface(ctx, "s");
      surface.dataModel = { arr: [{ n: "x" }, { n: "y" }, { n: "z" }] };
      upsertHydrateNode(ctx, {
        componentId: "t",
        nodeToken: createNodeToken(),
        _vnode: null,
        ownerSurfaceId: "s",
        protocol: textTemplateLine("t"),
        hasMounted: true,
      });

      const children = renderTemplateChildren(ctx, "s", surface.dataModel, {
        componentId: "t",
        dataBinding: "/arr",
      });

      assert.deepStrictEqual(
        children.map((child) => child.key),
        ["0", "1", "2"],
      );
      // item 作用域：scoped context 的 dataModel 是该 item 本身
      const scoped = children.map(
        (child) => (child.vnode as { context: RenderContext }).context.dataModel,
      );
      assert.deepStrictEqual(scoped, [{ n: "x" }, { n: "y" }, { n: "z" }]);
    });

    it("绑定处为对象（valueMap）时应按 key 迭代 values", () => {
      setRenderMap(capturingTextMap);
      const ctx = createParseContext();
      const surface = ensureSurface(ctx, "s");
      surface.dataModel = {
        members: {
          a: { n: "x" },
          b: { n: "y" },
        },
      };
      upsertHydrateNode(ctx, {
        componentId: "t",
        nodeToken: createNodeToken(),
        _vnode: null,
        ownerSurfaceId: "s",
        protocol: textTemplateLine("t"),
        hasMounted: true,
      });

      const children = renderTemplateChildren(ctx, "s", surface.dataModel, {
        componentId: "t",
        dataBinding: "/members",
      });

      assert.deepStrictEqual(
        children.map((child) => [child.key, (child.vnode as { context: RenderContext }).context.dataModel]),
        [
          ["a", { n: "x" }],
          ["b", { n: "y" }],
        ],
      );
    });

    it("绑定处为原始值 / null / 缺失路径时应返回空数组", () => {
      setRenderMap(capturingTextMap);
      const ctx = createParseContext();
      const surface = ensureSurface(ctx, "s");
      surface.dataModel = { n: 5 };
      upsertHydrateNode(ctx, {
        componentId: "t",
        nodeToken: createNodeToken(),
        _vnode: null,
        ownerSurfaceId: "s",
        protocol: textTemplateLine("t"),
        hasMounted: true,
      });

      assert.deepStrictEqual(
        renderTemplateChildren(ctx, "s", surface.dataModel, {
          componentId: "t",
          dataBinding: "/n",
        }),
        [],
      );
      assert.deepStrictEqual(
        renderTemplateChildren(ctx, "s", surface.dataModel, {
          componentId: "t",
          dataBinding: "/missing",
        }),
        [],
      );
    });

    it("模板组件未注册时应跳过该 item", () => {
      setRenderMap(capturingTextMap);
      const ctx = createParseContext();
      const surface = ensureSurface(ctx, "s");
      surface.dataModel = { arr: [{ n: "x" }] };
      upsertHydrateNode(ctx, {
        componentId: "other",
        nodeToken: createNodeToken(),
        _vnode: null,
        ownerSurfaceId: "s",
        protocol: textTemplateLine("other"),
        hasMounted: true,
      });

      // componentId 指向不存在的模板节点
      assert.deepStrictEqual(
        renderTemplateChildren(ctx, "s", surface.dataModel, {
          componentId: "missing-tpl",
          dataBinding: "/arr",
        }),
        [],
      );
    });
  });
});
