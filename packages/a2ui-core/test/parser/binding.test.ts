import assert from "node:assert";
import {
  getPathValue,
  resolveValueBinding,
} from "../../src/parser/binding.js";

describe("类型化值绑定", () => {
  describe("resolveValueBinding", () => {
    it("应解析 literalString", () => {
      assert.strictEqual(
        resolveValueBinding({ literalString: "hi" }),
        "hi",
      );
    });

    it("应解析 literalNumber", () => {
      assert.strictEqual(resolveValueBinding({ literalNumber: 3.5 }), 3.5);
    });

    it("应解析 literalBoolean（含 false）", () => {
      assert.strictEqual(resolveValueBinding({ literalBoolean: false }), false);
      assert.strictEqual(resolveValueBinding({ literalBoolean: true }), true);
    });

    it("应按 path 从数据模型取值", () => {
      assert.strictEqual(
        resolveValueBinding({ path: "/a" }, { a: "model-value" }),
        "model-value",
      );
    });

    it("path 应支持数组下标", () => {
      const model = { items: [{ name: "first" }, { name: "second" }] };
      assert.strictEqual(getPathValue("/items/1/name", model), "second");
    });

    it("未定义绑定应返回 null", () => {
      assert.strictEqual(resolveValueBinding(undefined, {}), null);
    });
  });
});
