import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorType } from "../../src/store/types.js";
// 待实现模块（TDD 红灯阶段：此时 src/parser/index.ts 尚不存在 parseProtocol）
import { parseProtocol } from "../../src/parser/index.js";
import { setRenderMap } from "../../src/parser/render-registry.js";

// 读取 mock 协议：mock/text-v0.8.jsonl
const mockPath = fileURLToPath(
  new URL("../../mock/text-v0.8.jsonl", import.meta.url),
);
const mockJsonl = readFileSync(mockPath, "utf8");

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
});
