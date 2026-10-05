import assert from "node:assert";
import {
  createParser,
  extractLocalUpdate,
  parseProtocol,
  resolveValueBinding,
  type RenderContext,
  type RenderMap,
  type UserAction,
} from "../../src/parser/index.js";
import {
  setActionSink,
  setRenderMap,
} from "../../src/parser/render-registry.js";
import { messages as localUpdateMessages } from "../../mock/local-update-messages.js";

/** 测试 vnode（Button 暴露 onClick 供测试触发） */
interface TestVNode {
  kind: string;
  context: RenderContext;
  onClick?: () => void;
}

/**
 * 与 a2ui-react renderMap 的 Button 适配器同构：
 * action.localUpdate 命中 → 本地 writeDataModel；否则 emitUserAction。
 */
const testRenderMap: RenderMap = {
  Text: (_props, context) => ({ kind: "Text", context }) as TestVNode as never,
  Column: (_props, context) =>
    ({ kind: "Column", context }) as TestVNode as never,
  Button: (props, context) => {
    const action = (
      props as {
        action?: Parameters<typeof extractLocalUpdate>[0] & {
          name: string;
        };
      }
    ).action;
    return {
      kind: "Button",
      context,
      onClick: () => {
        if (!action) return;
        const localUpdate = extractLocalUpdate(action);
        if (localUpdate) {
          context.writeDataModel?.(
            localUpdate.path,
            resolveValueBinding(localUpdate.value, context.dataModel),
          );
          return;
        }
        context.emitUserAction?.(action.name, {});
      },
    } as TestVNode as never;
  },
};

const fullJsonl = localUpdateMessages.join("\n");

function nodeVNode(
  result: ReturnType<typeof parseProtocol>,
  componentId: string,
): TestVNode {
  const node = result.hydrateNodes.find(
    (item) => item.componentId === componentId,
  );
  assert.ok(node, `节点 ${componentId} 应存在`);
  return node!._vnode as TestVNode;
}

describe("action.localUpdate 纯逻辑", () => {
  it("应提取合法 localUpdate", () => {
    assert.deepStrictEqual(
      extractLocalUpdate({
        name: "a",
        localUpdate: {
          path: "/message",
          value: { literalString: "x" },
        },
      }),
      { path: "/message", value: { literalString: "x" } },
    );
  });

  it("无 localUpdate / path 非法 / value 非对象时应返回 undefined", () => {
    assert.strictEqual(extractLocalUpdate({ name: "a" }), undefined);
    assert.strictEqual(
      extractLocalUpdate({
        localUpdate: { value: { literalString: "x" } },
      }),
      undefined,
    );
    assert.strictEqual(
      extractLocalUpdate({
        localUpdate: { path: "  ", value: { literalString: "x" } },
      }),
      undefined,
    );
    assert.strictEqual(
      extractLocalUpdate({
        localUpdate: { path: "/m", value: "nope" },
      }),
      undefined,
    );
    assert.strictEqual(extractLocalUpdate(null), undefined);
  });
});

describe("本地更新端到端（local-update mock：按钮更新一行文案）", () => {
  let sinkCalls: UserAction[];

  beforeEach(() => {
    sinkCalls = [];
    setRenderMap(testRenderMap);
    setActionSink((action) => sinkCalls.push(action));
  });

  afterEach(() => {
    setRenderMap(null);
    setActionSink(null);
  });

  it("初始：1 surface、4 节点、0 错误，文案为 Before click", () => {
    const result = parseProtocol(fullJsonl);
    assert.strictEqual(result.surfaces.length, 1);
    assert.strictEqual(result.hydrateNodes.length, 4);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.surfaces[0].dataModel?.message, "Before click");
  });

  it("点击按钮：本地更新 /message，文案变为 updated locally", () => {
    const parser = createParser();
    for (const line of localUpdateMessages) parser.parse(line);
    assert.strictEqual(sinkCalls.length, 0);

    // 触发按钮（与真实点击调用同一 onClick）
    const button = nodeVNode(parser.getResult(), "update_button");
    button.onClick?.();

    const after = parser.getResult();
    assert.strictEqual(
      after.surfaces[0].dataModel?.message,
      "After click: updated locally",
    );
    // 消费该路径的 Text 节点已随本地 cycle 重渲染
    const textNode = nodeVNode(after, "message_text");
    assert.strictEqual(
      textNode.context.dataModel?.message,
      "After click: updated locally",
    );
  });

  it("本地更新不派发 userAction（action sink 零调用）", () => {
    const parser = createParser();
    for (const line of localUpdateMessages) parser.parse(line);
    nodeVNode(parser.getResult(), "update_button").onClick?.();
    assert.strictEqual(sinkCalls.length, 0);
  });

  it("localUpdate.value 为 path 引用时：应把 dataModel 中另一处的值写入目标", () => {
    const parser = createParser();
    parser.parse(
      '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"draft","valueString":"Copied from draft"},{"key":"message","valueString":"old"}]}}',
    );
    parser.parse(
      '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"r","component":{"Column":{"children":{"explicitList":["t","b"]}}}},{"id":"t","component":{"Text":{"text":{"path":"/message"}}}},{"id":"b","component":{"Button":{"child":"bl","action":{"name":"copy_draft","localUpdate":{"path":"/message","value":{"path":"/draft"}}}}}},{"id":"bl","component":{"Text":{"text":{"literalString":"Apply"}}}}]}}',
    );
    parser.parse('{"beginRendering":{"surfaceId":"main","root":"r"}}');

    nodeVNode(parser.getResult(), "b").onClick?.();
    assert.strictEqual(
      parser.getResult().surfaces[0].dataModel?.message,
      "Copied from draft",
    );
  });

  it("回归：无 localUpdate 的普通 action 仍派发 userAction 到 sink", () => {
    const parser = createParser();
    parser.parse(
      '{"dataModelUpdate":{"surfaceId":"main","path":"/","contents":[{"key":"v","valueString":"x"}]}}',
    );
    parser.parse(
      '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"r","component":{"Column":{"children":{"explicitList":["b"]}}}},{"id":"b","component":{"Button":{"child":"bl","action":{"name":"plain_action"}}}},{"id":"bl","component":{"Text":{"text":{"literalString":"Go"}}}}]}}',
    );
    parser.parse('{"beginRendering":{"surfaceId":"main","root":"r"}}');

    nodeVNode(parser.getResult(), "b").onClick?.();
    assert.strictEqual(sinkCalls.length, 1);
    assert.strictEqual(sinkCalls[0].name, "plain_action");
    assert.strictEqual(sinkCalls[0].sourceComponentId, "b");
    assert.ok(sinkCalls[0].timestamp);
  });
});
