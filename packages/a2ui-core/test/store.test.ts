import assert from "node:assert";
import { initStore, getA2UIStore } from "../src/index.js";

describe("A2UI store 初始化", () => {
  it("initStore 应返回一个有效的 store 实例", () => {
    const store = initStore(); 
    assert.ok(store, "store 实例不应为空");
    assert.strictEqual(typeof store.getState, "function");
    assert.strictEqual(typeof store.setState, "function");
    assert.strictEqual(typeof store.subscribe, "function");
  });

  it("初始化后状态应为干净的初始值", () => {
    const state = initStore().getState();
    assert.strictEqual(state.rawProtocol, "");
    assert.deepStrictEqual(state.surfaceMap, {});
    assert.deepStrictEqual(state.hydrateNodeMap, {});
    assert.deepStrictEqual(state.errorMap, {});
  });

  it("初始化后可通过 getA2UIStore 获取同一个单例", () => {
    const store = initStore();
    assert.strictEqual(getA2UIStore(), store);
  });

  it("initStore 支持传入初始协议", () => {
    const protocol = '{"type":"root"}';
    const store = initStore(protocol);
    assert.strictEqual(store.getState().rawProtocol, protocol);
  });

  it("再次调用 initStore 会重置已有状态", () => {
    const store = initStore();
    store.getState().addSurface({
      id: "s1",
      beginRender: false,
      rootNode: null,
    });
    assert.ok(store.getState().getSurface("s1"));

    const reset = initStore();
    assert.deepStrictEqual(reset.getState().surfaceMap, {});
    assert.strictEqual(reset.getState().getSurface("s1"), undefined);
  });
});
