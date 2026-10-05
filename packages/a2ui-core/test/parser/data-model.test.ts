import assert from "node:assert";
import type { Surface } from "../../src/store/types.js";
import {
  applyDataModelUpdate,
  buildContentsObject,
  commitLocalWrite,
  splitPath,
} from "../../src/parser/data-model.js";

/** 构造仅含 dataModel 的测试 surface */
function makeSurface(
  dataModel?: Record<string, unknown>,
): Surface {
  return {
    id: "main",
    beginRender: false,
    rootNode: null,
    dataModel,
  };
}

describe("data-model 纯逻辑", () => {
  describe("splitPath", () => {
    it("应把 /a/b 切为 ['a','b']", () => {
      assert.deepStrictEqual(splitPath("/a/b"), ["a", "b"]);
    });

    it("空路径 / undefined / 根路径均应切为空数组", () => {
      assert.deepStrictEqual(splitPath(undefined), []);
      assert.deepStrictEqual(splitPath(""), []);
      assert.deepStrictEqual(splitPath("/"), []);
    });

    it("应 trim 每段并过滤空段", () => {
      assert.deepStrictEqual(splitPath("/ a /b/"), ["a", "b"]);
    });
  });

  describe("buildContentsObject", () => {
    it("应支持多 key 与多种 typed value", () => {
      const result = buildContentsObject([
        { key: "s", valueString: "hello" },
        { key: "n", valueNumber: 42 },
        { key: "b", valueBoolean: false },
      ]);
      assert.deepStrictEqual(result, { s: "hello", n: 42, b: false });
    });

    it("valueMap 邻接表应递归展开为对象", () => {
      const result = buildContentsObject([
        {
          key: "form",
          valueMap: [
            { key: "user", valueString: "alice" },
            {
              key: "nested",
              valueMap: [{ key: "deep", valueNumber: 1 }],
            },
          ],
        },
      ]);
      assert.deepStrictEqual(result, {
        form: { user: "alice", nested: { deep: 1 } },
      });
    });

    it("非法条目应跳过", () => {
      const result = buildContentsObject([
        null,
        "bad",
        { valueString: "no key" },
        { key: "ok", valueString: "yes" },
      ]);
      assert.deepStrictEqual(result, { ok: "yes" });
    });
  });

  describe("applyDataModelUpdate", () => {
    it("path 省略时应整模型替换（旧 key 丢弃）", () => {
      const surface = makeSurface({ old: 1 });
      applyDataModelUpdate(surface, undefined, [
        { key: "fresh", valueString: "x" },
      ]);
      assert.deepStrictEqual(surface.dataModel, { fresh: "x" });
    });

    it('path 为 "/" 时应整模型替换', () => {
      const surface = makeSurface({ old: 1 });
      applyDataModelUpdate(surface, "/", [
        { key: "fresh", valueNumber: 2 },
      ]);
      assert.deepStrictEqual(surface.dataModel, { fresh: 2 });
    });

    it("嵌套 path 应在目标对象上合并新 key", () => {
      const surface = makeSurface({ a: { x: 1, y: 2 } });
      applyDataModelUpdate(surface, "/a", [{ key: "z", valueNumber: 3 }]);
      assert.deepStrictEqual(surface.dataModel, {
        a: { x: 1, y: 2, z: 3 },
      });
    });

    it("缺失的中间容器应沿路径创建", () => {
      const surface = makeSurface({});
      applyDataModelUpdate(surface, "/a/b", [{ key: "c", valueNumber: 1 }]);
      assert.deepStrictEqual(surface.dataModel, { a: { b: { c: 1 } } });
    });

    it("目标位置为非对象时应重建为 incoming 对象", () => {
      const surface = makeSurface({ a: 5 });
      applyDataModelUpdate(surface, "/a", [{ key: "x", valueNumber: 1 }]);
      assert.deepStrictEqual(surface.dataModel, { a: { x: 1 } });
    });

    it("嵌套写入时路径沿线应产生新引用、未触及分支引用不变", () => {
      const untouched = { keep: true };
      const surface = makeSurface({ a: { b: { deep: 1 } }, untouched });
      applyDataModelUpdate(surface, "/a/b", [
        { key: "deep", valueNumber: 2 },
      ]);
      assert.strictEqual(surface.dataModel?.untouched, untouched);
      assert.notStrictEqual(surface.dataModel?.a, undefined);
      assert.deepStrictEqual(surface.dataModel?.a, { b: { deep: 2 } });
    });

    it("path 非字符串时应按整替换处理", () => {
      const surface = makeSurface({ old: 1 });
      applyDataModelUpdate(surface, 7, [{ key: "k", valueString: "v" }]);
      assert.deepStrictEqual(surface.dataModel, { k: "v" });
    });
  });

  describe("commitLocalWrite", () => {
    it("应按 path 不可变深写并回写", () => {
      const surface = makeSurface({ a: { b: 1 }, other: { n: 9 } });
      commitLocalWrite(surface, "/a/b", 2);
      assert.deepStrictEqual(surface.dataModel, {
        a: { b: 2 },
        other: { n: 9 },
      });
    });

    it("应支持数组下标写入", () => {
      const surface = makeSurface({ items: [10, 20] });
      commitLocalWrite(surface, "/items/1", 99);
      assert.deepStrictEqual(surface.dataModel, { items: [10, 99] });
    });

    it("空 path 且 value 为对象时应替换根", () => {
      const surface = makeSurface({ old: 1 });
      commitLocalWrite(surface, "/", { fresh: true });
      assert.deepStrictEqual(surface.dataModel, { fresh: true });
    });

    it("空 path 且 value 为非对象时应忽略", () => {
      const surface = makeSurface({ old: 1 });
      commitLocalWrite(surface, "/", 123);
      assert.deepStrictEqual(surface.dataModel, { old: 1 });
    });

    it("空模型深写时应创建中间容器", () => {
      const surface = makeSurface();
      commitLocalWrite(surface, "/a/b", "x");
      assert.deepStrictEqual(surface.dataModel, { a: { b: "x" } });
    });
  });
});
