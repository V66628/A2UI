import assert from "node:assert";
import { createParser } from "../../src/parser/index.js";
import {
  setActionSink,
  setLocalChangeNotifier,
  setRenderMap,
  setTreeRenderer,
} from "../../src/parser/render-registry.js";
import { resolveValueBinding } from "../../src/parser/binding.js";
import type {
  ParseResult,
  RenderContext,
  RenderMap,
  UserAction,
} from "../../src/parser/index.js";
import { messages as loginMessages } from "../../mock/login-form-messages.js";

/**
 * 测试用 vnode：把 props 与 context 原样带出，
 * 便于在无 React 环境下模拟交互组件回调。
 */
interface TestVNode {
  type: string;
  props: Record<string, unknown>;
  context: RenderContext;
}

/** 测试用 renderMap：覆盖登录表单涉及的 4 种组件 */
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

/** 按 componentId 从结果中取出节点的测试 vnode */
function getVNode(
  result: ParseResult,
  componentId: string,
): TestVNode | undefined {
  const node = result.hydrateNodes.find(
    (item) => item.componentId === componentId,
  );
  return (node?._vnode as TestVNode | null) ?? undefined;
}

describe("引擎数据绑定集成", () => {
  beforeEach(() => {
    setRenderMap(testRenderMap);
    setTreeRenderer(null);
  });

  afterEach(() => {
    setActionSink(null);
    setLocalChangeNotifier(null);
    setRenderMap(null);
  });

  it("writeDataModel 应触发本地重渲染 cycle 并经 notifier 给出新模型", () => {
    const received: ParseResult[] = [];
    setLocalChangeNotifier((result) => received.push(result));

    const parser = createParser();
    for (const line of loginMessages) parser.parse(line);

    const field = getVNode(parser.getResult(), "username_field");
    assert.ok(field);
    field.context.writeDataModel?.("/username", "alice");

    assert.strictEqual(received.length, 1);
    const surface = received[0].surfaces.find((item) => item.id === "main");
    assert.strictEqual(surface?.dataModel?.username, "alice");

    // 重渲染后 TextField 节点拿到的 context 已含最新模型
    const updatedField = getVNode(received[0], "username_field");
    assert.strictEqual(updatedField?.context.dataModel?.username, "alice");
  });

  it("emitUserAction 应经 ActionSink 收到含 ISO8601 timestamp 的完整动作", () => {
    const received: UserAction[] = [];
    setActionSink((action) => received.push(action));

    const parser = createParser();
    for (const line of loginMessages) parser.parse(line);

    const button = getVNode(parser.getResult(), "submit_button");
    assert.ok(button);
    button.context.emitUserAction?.("login_submitted", {
      user: "alice",
      pass: "secret",
    });

    assert.strictEqual(received.length, 1);
    const action = received[0];
    assert.strictEqual(action.name, "login_submitted");
    assert.strictEqual(action.surfaceId, "main");
    assert.strictEqual(action.sourceComponentId, "submit_button");
    assert.deepStrictEqual(action.context, {
      user: "alice",
      pass: "secret",
    });
    // ISO 8601（toISOString 形如 2025-06-08T...Z）
    assert.match(
      action.timestamp,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("登录表单端到端：输入经 path 写入后，点击解析出的 context 应含输入值", () => {
    const received: UserAction[] = [];
    setActionSink((action) => received.push(action));

    let latest!: ParseResult;
    setLocalChangeNotifier((result) => {
      latest = result;
    });

    const parser = createParser();
    for (const line of loginMessages) parser.parse(line);

    // 组件树根为 root，6 个组件全部渲染
    assert.strictEqual(
      parser.getResult().trees[0]?.root?.node.componentId,
      "root",
    );
    assert.strictEqual(parser.getResult().hydrateNodes.length, 6);

    // 模拟输入用户名 / 密码（各自 path 绑定）
    getVNode(parser.getResult(), "username_field")?.context.writeDataModel?.(
      "/username",
      "alice",
    );
    getVNode(latest, "password_field")?.context.writeDataModel?.(
      "/password",
      "secret",
    );

    // 模拟 Button 点击（与 react renderMap 适配器同一套解析）：
    // 用最新模型解析 action.context，再 emitUserAction
    const button = getVNode(latest!, "submit_button");
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

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].name, "login_submitted");
    assert.deepStrictEqual(received[0].context, {
      user: "alice",
      pass: "secret",
    });
  });
});
