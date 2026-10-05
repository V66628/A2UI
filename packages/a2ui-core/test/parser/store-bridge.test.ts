import assert from "node:assert";
import {
  getOutgoingActions,
  init,
} from "../../src/index.js";
import { resolveValueBinding } from "../../src/parser/binding.js";
import { createParser } from "../../src/parser/index.js";
import {
  setDataModelBridge,
  setRenderMap,
} from "../../src/parser/render-registry.js";
import type {
  ParseResult,
  RenderContext,
  RenderMap,
} from "../../src/parser/index.js";
import { messages as loginMessages } from "../../mock/login-form-messages.js";

/** 测试用 vnode：带出 props 与 RenderContext，无 React 也能模拟交互 */
interface TestVNode {
  type: string;
  props: Record<string, unknown>;
  context: RenderContext;
}

const testRenderMap: RenderMap = {
  Text: (props, context) =>
    ({ type: "Text", props, context }) as TestVNode as never,
  TextField: (props, context) =>
    ({ type: "TextField", props, context }) as TestVNode as never,
  Button: (props, context) =>
    ({ type: "Button", props, context }) as TestVNode as never,
  Column: (props, context) =>
    ({ type: "Column", props, context }) as TestVNode as never,
};

function getVNode(
  result: ParseResult,
  componentId: string,
): TestVNode | undefined {
  const node = result.hydrateNodes.find(
    (item) => item.componentId === componentId,
  );
  return (node?._vnode as TestVNode | null) ?? undefined;
}

describe("中心 store 数据模型桥", () => {
  afterEach(() => {
    // 防止桥泄漏影响其他测试文件的独立 parser
    setDataModelBridge(null);
    setRenderMap(null);
  });

  it("dataModelUpdate 在 parse 时应首先写入中心 store（无需 parse 后手工同步）", () => {
    const store = init(undefined, testRenderMap, null);
    const parser = createParser();

    // 只解析第一条消息 dataModelUpdate
    parser.parse(loginMessages[0]);

    const storeSurface = store.getState().surfaceMap.main;
    assert.ok(storeSurface, "parse 时 store 中应已创建 surface");
    assert.deepStrictEqual(storeSurface.dataModel, {
      username: "",
      password: "",
    });
  });

  it("渲染期数据模型消费应全部来自中心 store（引用一致）", () => {
    const store = init(undefined, testRenderMap, null);
    const parser = createParser();
    for (const line of loginMessages) parser.parse(line);

    const storeDataModel = store.getState().surfaceMap.main.dataModel;
    assert.ok(storeDataModel);
    // 即使组件定义在后续消息才到达，每个节点拿到的 dataModel 都是 store 中那一份
    assert.strictEqual(
      getVNode(parser.getResult(), "username_field")?.context.dataModel,
      storeDataModel,
    );
    assert.strictEqual(
      getVNode(parser.getResult(), "submit_button")?.context.dataModel,
      storeDataModel,
    );
  });

  it("本地写应先落中心 store，重渲染后节点经桥读到新模型", () => {
    const store = init(undefined, testRenderMap, null);
    const parser = createParser();
    for (const line of loginMessages) parser.parse(line);

    getVNode(parser.getResult(), "username_field")?.context.writeDataModel?.(
      "/username",
      "alice",
    );

    // store 已更新（数据源）
    assert.strictEqual(
      store.getState().surfaceMap.main.dataModel?.username,
      "alice",
    );

    // 本地 cycle 重渲染后的节点 context 也来自 store
    const updated = getVNode(parser.getResult(), "username_field");
    assert.strictEqual(
      updated?.context.dataModel,
      store.getState().surfaceMap.main.dataModel,
    );
  });

  it("嵌套 path 的 dataModelUpdate 应深写进 store 中的数据模型", () => {
    const store = init(undefined, testRenderMap, null);
    const parser = createParser();
    parser.parse(loginMessages[0]);
    parser.parse(
      '{"dataModelUpdate":{"surfaceId":"main","path":"/meta","contents":[{"key":"v","valueNumber":1}]}}',
    );

    assert.deepStrictEqual(store.getState().surfaceMap.main.dataModel, {
      username: "",
      password: "",
      meta: { v: 1 },
    });
  });

  it("登录表单端到端：store 模型 → 输入 → 点击，outgoing action 含输入值", () => {
    init(undefined, testRenderMap, null);
    const parser = createParser();
    for (const line of loginMessages) parser.parse(line);

    getVNode(parser.getResult(), "username_field")?.context.writeDataModel?.(
      "/username",
      "alice",
    );
    getVNode(parser.getResult(), "password_field")?.context.writeDataModel?.(
      "/password",
      "secret",
    );

    // 与 react renderMap 同一套解析：用最新模型解析 action.context 后派发
    const button = getVNode(parser.getResult(), "submit_button");
    assert.ok(button);
    const actionSpec = button.props.action as {
      name: string;
      context: Array<{ key: string; value: unknown }>;
    };
    const resolved: Record<string, unknown> = {};
    for (const item of actionSpec.context) {
      resolved[item.key] = resolveValueBinding(
        item.value as never,
        button.context.dataModel,
      );
    }
    button.context.emitUserAction?.(actionSpec.name, resolved);

    const outgoing = getOutgoingActions();
    assert.strictEqual(outgoing.length, 1);
    assert.strictEqual(outgoing[0].name, "login_submitted");
    assert.strictEqual(outgoing[0].surfaceId, "main");
    assert.deepStrictEqual(outgoing[0].context, {
      user: "alice",
      pass: "secret",
    });
  });
});
