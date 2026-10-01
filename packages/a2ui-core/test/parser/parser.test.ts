import assert from "node:assert";
import { ErrorType } from "../../src/store/types.js";
// 待实现模块（TDD 红灯阶段：此时 src/parser/index.ts 尚不存在 parseProtocol）
import {
  createParser,
  parseProtocol,
  type RenderContext,
} from "../../src/parser/index.js";
import {
  setMountNotifier,
  setRenderMap,
  setTreeRenderer,
} from "../../src/parser/render-registry.js";
import type { ComponentTree } from "../../src/treebuilder/types.js";
import { messages as mockMessages } from "../../mock/text-messages.js";

// mock 协议：TS 模块定义的消息数组，整体拼接为 JSONL
const mockJsonl = mockMessages.join("\n");

describe("A2UI parser", () => {
  describe("整体返回结构", () => {
    it("应返回包含 surfaces / hydrateNodes / errors 三个数组的结果", () => {
      const result = parseProtocol(mockJsonl);
      assert.ok(Array.isArray(result.surfaces));
      assert.ok(Array.isArray(result.hydrateNodes));
      assert.ok(Array.isArray(result.errors));
    });
  });

  describe("解析 surfaceUpdate → HydrateNode", () => {
    it("应生成 1 个 hydrateNode", () => {
      const result = parseProtocol(mockJsonl);
      assert.strictEqual(result.hydrateNodes.length, 1);
    });

    it("componentId 应为组件 id（root）", () => {
      const result = parseProtocol(mockJsonl);
      assert.strictEqual(result.hydrateNodes[0].componentId, "root");
    });

    it("ownerSurfaceId 应为 surfaceId（main）", () => {
      const result = parseProtocol(mockJsonl);
      assert.strictEqual(result.hydrateNodes[0].ownerSurfaceId, "main");
    });

    it("protocol 应保留 JSONL 协议原文（包含 Text 与 literalString）", () => {
      const result = parseProtocol(mockJsonl);
      const protocol = result.hydrateNodes[0].protocol;
      assert.strictEqual(typeof protocol, "string");
      const parsed = JSON.parse(protocol);
      assert.strictEqual(
        parsed.surfaceUpdate.components[0].component.Text.text.literalString,
        "Hello A2UI",
      );
    });

    it("parser 阶段不创建框架 vnode，_vnode 应为 null", () => {
      const result = parseProtocol(mockJsonl);
      assert.strictEqual(result.hydrateNodes[0]._vnode, null);
    });
  });

  describe("解析 beginRendering → Surface", () => {
    it("应生成 1 个 surface，id 为 main", () => {
      const result = parseProtocol(mockJsonl);
      assert.strictEqual(result.surfaces.length, 1);
      assert.strictEqual(result.surfaces[0].id, "main");
    });

    it("beginRendering 后 beginRender 应为 true", () => {
      const result = parseProtocol(mockJsonl);
      assert.strictEqual(result.surfaces[0].beginRender, true);
    });

    it("rootNode 应指向 root id 对应的 hydrateNode（同一对象引用）", () => {
      const result = parseProtocol(mockJsonl);
      const rootNode = result.surfaces[0].rootNode;
      assert.ok(rootNode);
      assert.strictEqual(rootNode!.componentId, "root");
      assert.strictEqual(rootNode, result.hydrateNodes[0]);
    });
  });

  describe("渲染信号前的缓冲行为", () => {
    // 仅取第一条 surfaceUpdate，不含 beginRendering
    const firstLine = mockJsonl.trim().split("\n")[0];

    it("surfaceUpdate 已创建 surface，但 beginRender 应为 false", () => {
      const result = parseProtocol(firstLine);
      assert.strictEqual(result.surfaces.length, 1);
      assert.strictEqual(result.surfaces[0].beginRender, false);
    });

    it("收到渲染信号前 rootNode 应为 null", () => {
      const result = parseProtocol(firstLine);
      assert.strictEqual(result.surfaces[0].rootNode, null);
    });

    it("hydrateNode 已被解析缓冲", () => {
      const result = parseProtocol(firstLine);
      assert.strictEqual(result.hydrateNodes.length, 1);
    });
  });

  describe("容错行为", () => {
    it("应忽略空行", () => {
      const result = parseProtocol("  \n\n   \n");
      assert.strictEqual(result.surfaces.length, 0);
      assert.strictEqual(result.hydrateNodes.length, 0);
      assert.strictEqual(result.errors.length, 0);
    });

    it("非法 JSON 行应记录 PARSE_ERROR 且不中断后续解析", () => {
      const validLine = mockJsonl.trim().split("\n")[0];
      const result = parseProtocol(`${validLine}\nthis-is-not-json`);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].type, ErrorType.PARSE_ERROR);
      assert.ok(result.errors[0].content.length > 0);
      // 合法消息仍被解析
      assert.strictEqual(result.hydrateNodes.length, 1);
    });

    it("beginRendering 引用不存在的 root 应记录 PARSE_ERROR", () => {
      const validLine = mockJsonl.trim().split("\n")[0];
      const badRender = JSON.stringify({
        beginRendering: { surfaceId: "main", root: "not-exist" },
      });
      const result = parseProtocol(`${validLine}\n${badRender}`);
      assert.ok(
        result.errors.some((e) => e.type === ErrorType.PARSE_ERROR),
        "应包含 PARSE_ERROR",
      );
      assert.strictEqual(result.surfaces[0].rootNode, null);
    });
  });

  describe("renderer 组件注册检查", () => {
    // 协议使用一个未在 renderMap 中注册的 Button 组件
    const unregisteredLine = JSON.stringify({
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "btn-1",
            component: { Button: { label: { literalString: "OK" } } },
          },
        ],
      },
    });

    // 避免污染同进程内的其他测试文件
    afterEach(() => setRenderMap(null));

    it("组件类型未注册时应记录 COMPONENT_NOT_REGISTERED 且描述包含定位信息", () => {
      setRenderMap({ Text: () => ({ fake: "vnode" }) });
      const result = parseProtocol(unregisteredLine);

      const error = result.errors.find(
        (e) => e.type === ErrorType.COMPONENT_NOT_REGISTERED,
      );
      assert.ok(error, "应记录 COMPONENT_NOT_REGISTERED 错误");
      assert.ok(error!.content.includes("Button"), "描述应包含组件类型");
      assert.ok(error!.content.includes("btn-1"), "描述应包含组件 id");
      assert.ok(error!.content.includes("main"), "描述应包含 surface id");

      // 未注册组件无法渲染，_vnode 保持 null
      assert.strictEqual(result.hydrateNodes[0]._vnode, null);
    });

    it("组件已注册时应正常渲染且不产生未注册错误", () => {
      const vnodeStub = { fake: "vnode" };
      setRenderMap({ Button: () => vnodeStub });
      const result = parseProtocol(unregisteredLine);

      assert.strictEqual(
        result.errors.some(
          (e) => e.type === ErrorType.COMPONENT_NOT_REGISTERED,
        ),
        false,
      );
      assert.strictEqual(result.hydrateNodes[0]._vnode, vnodeStub);
    });

    it("未设置 renderMap（框架无关模式）时不产生未注册错误", () => {
      setRenderMap(null);
      const result = parseProtocol(unregisteredLine);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.hydrateNodes[0]._vnode, null);
    });
  });

  describe("组件树渲染函数（init 注入，SDK 在 treebuild 后调用）", () => {
    afterEach(() => {
      setTreeRenderer(null);
      setRenderMap(null);
    });

    it("每次 parse 完成 treebuild 后调用一次渲染函数", () => {
      const trees: ComponentTree[] = [];
      setTreeRenderer((tree) => trees.push(tree));

      const parser = createParser();
      parser.parse(mockMessages[0]);
      assert.strictEqual(trees.length, 1);
      parser.parse(mockMessages[1]);
      assert.strictEqual(trees.length, 2);
    });

    it("渲染函数收到的组件树 surfaceId 为 main、根节点随 beginRendering 变为 root", () => {
      const trees: ComponentTree[] = [];
      setTreeRenderer((tree) => trees.push(tree));

      const parser = createParser();
      parser.parse(mockMessages[0]);
      parser.parse(mockMessages[1]);

      const last = trees[trees.length - 1];
      assert.strictEqual(last.surfaceId, "main");
      assert.strictEqual(last.root?.node.componentId, "root");
    });

    it("未注入渲染函数时 parse 行为不受影响", () => {
      setTreeRenderer(null);
      const result = createParser().parse(mockMessages[0]);
      assert.strictEqual(result.hydrateNodes.length, 1);
    });
  });

  describe("hasMounted 挂载标记（标记清除）", () => {
    afterEach(() => {
      setRenderMap(null);
      setMountNotifier(null);
    });

    /** 单 Text 组件的 surfaceUpdate 消息行 */
    const singleTextLine = (id: string): string =>
      JSON.stringify({
        surfaceUpdate: {
          surfaceId: "main",
          components: [
            { id, component: { Text: { text: { literalString: id } } } },
          ],
        },
      });

    it("parser 首次识别新组件时 hasMounted 为 false（节点与 RenderContext 均如此）", () => {
      const contexts: RenderContext[] = [];
      setRenderMap({
        Text: (_props, context) => {
          contexts.push(context);
          return {};
        },
      });

      const parser = createParser();
      parser.parse(singleTextLine("a"));

      assert.strictEqual(parser.getResult().hydrateNodes[0].hasMounted, false);
      assert.strictEqual(contexts[0].hasMounted, false);
    });

    it("调用 context.markMounted 后节点 hasMounted 变 true，并触发通知器；重复调用幂等", () => {
      let captured: RenderContext | null = null;
      setRenderMap({
        Text: (_props, context) => {
          captured = context;
          return {};
        },
      });
      const notified: string[] = [];
      setMountNotifier((componentId) => notified.push(componentId));

      const parser = createParser();
      parser.parse(singleTextLine("a"));

      captured!.markMounted();
      assert.strictEqual(parser.getResult().hydrateNodes[0].hasMounted, true);
      assert.deepStrictEqual(notified, ["a"]);

      // 再次调用幂等：不重复通知
      captured!.markMounted();
      assert.deepStrictEqual(notified, ["a"]);
    });

    it("同 id 组件再次 surfaceUpdate（组件更新）不重置 hasMounted", () => {
      let captured: RenderContext | null = null;
      setRenderMap({
        Text: (_props, context) => {
          captured = context;
          return {};
        },
      });

      const parser = createParser();
      parser.parse(singleTextLine("a"));
      captured!.markMounted();
      // 同 id 再次出现：新 RenderContext 也应读到 true
      parser.parse(singleTextLine("a"));

      assert.strictEqual(parser.getResult().hydrateNodes[0].hasMounted, true);
      assert.strictEqual(captured!.hasMounted, true);
    });

    it("节点每次创建都生成新 nodeToken；RenderContext.nodeToken 与节点一致", () => {
      const tokens: string[] = [];
      setRenderMap({
        Text: (_props, context) => {
          tokens.push(context.nodeToken);
          return {};
        },
      });

      const parser = createParser();
      parser.parse(singleTextLine("a"));
      parser.parse(singleTextLine("a"));

      // 每次 parse：surfaceUpdate 渲染 1 次 + rerenderAllNodes 1 次
      assert.strictEqual(tokens.length, 4);
      assert.strictEqual(tokens[0], tokens[1]);
      assert.strictEqual(tokens[2], tokens[3]);
      assert.notStrictEqual(tokens[0], tokens[2]);
      assert.strictEqual(
        tokens[3],
        parser.getResult().hydrateNodes[0].nodeToken,
      );
    });
  });
});
