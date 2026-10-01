import assert from "node:assert";
import { parseProtocol } from "../../src/parser/index.js";
import { setRenderMap } from "../../src/parser/render-registry.js";
import { buildTree, extractChildIds } from "../../src/treebuilder/index.js";
import type { ComponentTreeNode } from "../../src/treebuilder/types.js";
import type { HydrateNode } from "../../src/store/types.js";
import { messages as textMessages } from "../../mock/text-messages.js";
import { messages as columnMessages } from "../../mock/column-messages.js";

/**
 * treebuilder 组件树组装单元测试
 *
 * 覆盖：
 * - extractChildIds：child / children.explicitList 引用解析，
 *   template 与异常协议的边界
 * - buildTree：parent/children 递归组装、根定位（rootId / 单节点 /
 *   未被引用反推）、缺失引用跳过、环引用保护、深层嵌套
 * - 真实 mock：text（单节点）与 column（1 父 3 子）
 */

/** 按名称读取 TS mock 模块并拼接为 JSONL */
const mockJsonlByName: Record<string, string> = {
  text: textMessages.join("\n"),
  column: columnMessages.join("\n"),
};
function readMock(name: string): string {
  return mockJsonlByName[name];
}

/** 构造 surfaceUpdate 消息行 */
function surfaceUpdate(components: unknown[], surfaceId = "main"): string {
  return JSON.stringify({ surfaceUpdate: { surfaceId, components } });
}

/** 构造组件定义项 */
function component(id: string, type: string, props: unknown) {
  return { id, component: { [type]: props } };
}

/** 框架无关解析：得到 hydrateNode 集合 */
function parseNodes(jsonl: string): HydrateNode[] {
  setRenderMap(null);
  return parseProtocol(jsonl).hydrateNodes;
}

describe("A2UI treebuilder", () => {
  before(() => setRenderMap(null));

  describe("extractChildIds", () => {
    it("应解析 child（单子组件引用）", () => {
      const [node] = parseNodes(
        surfaceUpdate([
          component("btn", "Button", { child: "label-1" }),
          component("label-1", "Text", { text: { literalString: "OK" } }),
        ]),
      );
      assert.deepStrictEqual(extractChildIds(node), ["label-1"]);
    });

    it("应解析 children.explicitList（多子组件引用，保持顺序）", () => {
      const [node] = parseNodes(
        surfaceUpdate([
          component("col", "Column", {
            children: { explicitList: ["a", "b", "c"] },
          }),
        ]),
      );
      assert.deepStrictEqual(extractChildIds(node), ["a", "b", "c"]);
    });

    it("同时存在 child 与 children.explicitList 时应合并（child 在前）", () => {
      const [node] = parseNodes(
        surfaceUpdate([
          component("wrap", "Column", {
            child: "only",
            children: { explicitList: ["x"] },
          }),
        ]),
      );
      assert.deepStrictEqual(extractChildIds(node), ["only", "x"]);
    });

    it("children.template（数据驱动）暂不支持，应返回空数组", () => {
      const [node] = parseNodes(
        surfaceUpdate([
          component("col", "Column", {
            children: {
              template: { componentId: "tpl", dataBinding: "/items" },
            },
          }),
        ]),
      );
      assert.deepStrictEqual(extractChildIds(node), []);
    });

    it("无任何引用的叶子组件应返回空数组", () => {
      const [node] = parseNodes(
        surfaceUpdate([
          component("text-1", "Text", { text: { literalString: "Hi" } }),
        ]),
      );
      assert.deepStrictEqual(extractChildIds(node), []);
    });

    it("协议原文不是合法 JSON 时应返回空数组（不抛错）", () => {
      const node: HydrateNode = {
        componentId: "x",
        nodeToken: "test-token-x",
        _vnode: null,
        ownerSurfaceId: "main",
        protocol: "not-json",
        hasMounted: false,
      };
      assert.deepStrictEqual(extractChildIds(node), []);
    });
  });

  describe("buildTree - 根定位", () => {
    it("应优先使用 beginRendering 的 rootId", () => {
      const nodes = parseNodes(
        [
          surfaceUpdate([
            component("a", "Text", {}),
            component("b", "Text", {}),
          ]),
        ].join("\n"),
      );
      const tree = buildTree(nodes, "b", "main");
      assert.strictEqual(tree.surfaceId, "main");
      assert.strictEqual(tree.root!.node.componentId, "b");
    });

    it("未指定 rootId 且只有一个节点时以该节点为根", () => {
      const nodes = parseNodes(surfaceUpdate([component("only", "Text", {})]));
      const tree = buildTree(nodes, undefined, "main");
      assert.strictEqual(tree.root!.node.componentId, "only");
    });

    it("多节点且无 rootId 时，应以“未被引用”的唯一节点为根", () => {
      const nodes = parseNodes(
        surfaceUpdate([
          component("col", "Column", {
            children: { explicitList: ["t1", "t2"] },
          }),
          component("t1", "Text", {}),
          component("t2", "Text", {}),
        ]),
      );
      const tree = buildTree(nodes, undefined, "main");
      assert.strictEqual(tree.root!.node.componentId, "col");
    });

    it("rootId 不存在但存在唯一未被引用节点时应回退到该节点", () => {
      const nodes = parseNodes(
        surfaceUpdate([
          component("col", "Column", {
            children: { explicitList: ["t1"] },
          }),
          component("t1", "Text", {}),
        ]),
      );
      const tree = buildTree(nodes, "missing-id", "main");
      assert.strictEqual(tree.root!.node.componentId, "col");
    });

    it("存在多个未被引用节点（无法确定根）时 root 应为 null", () => {
      const nodes = parseNodes(
        surfaceUpdate([component("a", "Text", {}), component("b", "Text", {})]),
      );
      const tree = buildTree(nodes, undefined, "main");
      assert.strictEqual(tree.root, null);
    });
  });

  describe("buildTree - parent/children 组装", () => {
    it("子节点应按引用顺序挂载，叶子节点 children 为空", () => {
      const nodes = parseNodes(
        surfaceUpdate([
          component("col", "Column", {
            children: { explicitList: ["t1", "t2", "t3"] },
          }),
          component("t1", "Text", {}),
          component("t2", "Text", {}),
          component("t3", "Text", {}),
        ]),
      );
      const tree = buildTree(nodes, "col", "main");
      const root = tree.root!;
      assert.strictEqual(root.node.componentId, "col");
      assert.deepStrictEqual(
        root.children.map((child) => child.node.componentId),
        ["t1", "t2", "t3"],
      );
      for (const child of root.children) {
        assert.deepStrictEqual(child.children, []);
      }
    });

    it("组装出的节点应与扁平节点集合中的对象为同一引用", () => {
      const nodes = parseNodes(
        surfaceUpdate([
          component("col", "Column", {
            children: { explicitList: ["t1"] },
          }),
          component("t1", "Text", {}),
        ]),
      );
      const tree = buildTree(nodes, "col", "main");
      const t1 = nodes.find((n) => n.componentId === "t1");
      assert.strictEqual(tree.root!.children[0].node, t1);
    });

    it("引用的子 id 在节点集合中不存在时应跳过（不抛错）", () => {
      const nodes = parseNodes(
        surfaceUpdate([
          component("col", "Column", {
            children: { explicitList: ["t1", "ghost"] },
          }),
          component("t1", "Text", {}),
        ]),
      );
      const tree = buildTree(nodes, "col", "main");
      assert.strictEqual(tree.root!.children.length, 1);
      assert.strictEqual(tree.root!.children[0].node.componentId, "t1");
    });

    it("环引用应被访问集合保护，不产生无限递归", () => {
      // a.children=[b], b.children=[a]
      const nodes = parseNodes(
        surfaceUpdate([
          component("a", "Column", {
            children: { explicitList: ["b"] },
          }),
          component("b", "Column", {
            children: { explicitList: ["a"] },
          }),
        ]),
      );
      const tree = buildTree(nodes, "a", "main");
      assert.strictEqual(tree.root!.node.componentId, "a");
      assert.strictEqual(tree.root!.children.length, 1);
      assert.strictEqual(tree.root!.children[0].node.componentId, "b");
      // b 再次引用 a 时命中环保护，children 为空
      assert.deepStrictEqual(tree.root!.children[0].children, []);
    });

    it("应支持深层嵌套（Column 内 Column 内 Text）", () => {
      const nodes = parseNodes(
        surfaceUpdate([
          component("outer", "Column", {
            children: { explicitList: ["inner"] },
          }),
          component("inner", "Column", {
            children: { explicitList: ["leaf"] },
          }),
          component("leaf", "Text", {}),
        ]),
      );
      const tree = buildTree(nodes, "outer", "main");
      const inner = tree.root!.children[0];
      assert.strictEqual(inner.node.componentId, "inner");
      assert.strictEqual(inner.children[0].node.componentId, "leaf");
      assert.deepStrictEqual(inner.children[0].children, []);
    });
  });

  describe("真实 mock 协议", () => {
    it("text mock：单 Text 根节点，无 children", () => {
      const nodes = parseNodes(readMock("text"));
      const tree = buildTree(nodes, "root", "main");
      assert.strictEqual(tree.surfaceId, "main");
      assert.strictEqual(tree.root!.node.componentId, "root");
      assert.deepStrictEqual(tree.root!.children, []);
    });
  });

  describe("column mock 真实协议 - 树形结构处理", () => {
    const jsonl = readMock("column");

    it("parser 应解析出 4 个 hydrateNode（1 Column + 3 Text），全部属于 main", () => {
      const nodes = parseNodes(jsonl);
      assert.strictEqual(nodes.length, 4);
      assert.deepStrictEqual(
        nodes.map((node) => node.componentId),
        ["col-1", "text-1", "text-2", "text-3"],
      );
      for (const node of nodes) {
        assert.strictEqual(node.ownerSurfaceId, "main");
        assert.ok(node.protocol.length > 0);
      }
    });

    it("以 beginRendering 的 root（col-1）构建：Column 为父节点", () => {
      const nodes = parseNodes(jsonl);
      const tree = buildTree(nodes, "col-1", "main");

      assert.strictEqual(tree.surfaceId, "main");
      assert.ok(tree.root);
      assert.strictEqual(tree.root!.node.componentId, "col-1");
      // 根节点即扁平集合中的 col-1（同一引用）
      assert.strictEqual(
        tree.root!.node,
        nodes.find((node) => node.componentId === "col-1"),
      );
    });

    it("三个 Text 应按 explicitList 顺序（text-1/2/3）挂为 Column 的子节点", () => {
      const tree = buildTree(parseNodes(jsonl), "col-1", "main");
      const childIds = tree.root!.children.map(
        (child) => child.node.componentId,
      );
      assert.deepStrictEqual(childIds, ["text-1", "text-2", "text-3"]);
    });

    it("每个子节点与扁平节点集合中的对应对象为同一引用", () => {
      const nodes = parseNodes(jsonl);
      const tree = buildTree(nodes, "col-1", "main");
      tree.root!.children.forEach((child, index) => {
        const expectedId = `text-${index + 1}`;
        assert.strictEqual(
          child.node,
          nodes.find((node) => node.componentId === expectedId),
        );
      });
    });

    it("子节点协议中的文案应分别为第一/二/三行文本，usageHint 为 body", () => {
      const tree = buildTree(parseNodes(jsonl), "col-1", "main");
      const expectedTexts = ["第一行文本", "第二行文本", "第三行文本"];
      tree.root!.children.forEach((child, index) => {
        const message = JSON.parse(child.node.protocol);
        const item = message.surfaceUpdate.components.find(
          (entry: { id: string }) => entry.id === child.node.componentId,
        );
        assert.strictEqual(
          item.component.Text.text.literalString,
          expectedTexts[index],
        );
        assert.strictEqual(item.component.Text.usageHint, "body");
      });
    });

    it("三个 Text 均为叶子节点，children 为空数组", () => {
      const tree = buildTree(parseNodes(jsonl), "col-1", "main");
      for (const child of tree.root!.children) {
        assert.deepStrictEqual(child.children, []);
      }
    });

    it("整树节点总数应为 4（1 父 + 3 子），且为两层结构", () => {
      const tree = buildTree(parseNodes(jsonl), "col-1", "main");
      let count = 0;
      let depth = 0;
      const walk = (node: ComponentTreeNode, level: number): void => {
        count += 1;
        depth = Math.max(depth, level);
        node.children.forEach((child) => walk(child, level + 1));
      };
      walk(tree.root!, 0);
      assert.strictEqual(count, 4);
      assert.strictEqual(depth, 1);
    });

    it("不传 rootId 时应经“未被引用反推”得到 Column 根并挂 3 个子节点", () => {
      const tree = buildTree(parseNodes(jsonl), undefined, "main");
      assert.ok(tree.root);
      assert.strictEqual(tree.root!.node.componentId, "col-1");
      assert.strictEqual(tree.root!.children.length, 3);
    });

    it("构建过程不依赖 renderMap：框架无关模式下仍能正确组装（vnode 为 null）", () => {
      setRenderMap(null);
      const tree = buildTree(parseNodes(jsonl), "col-1", "main");
      assert.strictEqual(tree.root!.node._vnode, null);
      for (const child of tree.root!.children) {
        assert.strictEqual(child.node._vnode, null);
      }
    });
  });
});
