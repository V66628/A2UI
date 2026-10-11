import assert from "node:assert";
import { stylesToCss } from "../src/styles/index.js";
import type { ComponentStyles } from "../src/styles/types.js";

describe("stylesToCss（组件级 styles 协议转换）", () => {
  it("undefined / 空对象应返回空对象", () => {
    assert.deepStrictEqual(stylesToCss(undefined), {});
    assert.deepStrictEqual(stylesToCss({}), {});
  });

  it("长度类数值字段应追加 px", () => {
    const css = stylesToCss({
      width: 100,
      marginTop: 8,
      paddingLeft: 12,
      fontSize: 14,
      borderRadius: 6,
    });
    assert.strictEqual(css.width, "100px");
    assert.strictEqual(css.marginTop, "8px");
    assert.strictEqual(css.paddingLeft, "12px");
    assert.strictEqual(css.fontSize, "14px");
    assert.strictEqual(css.borderRadius, "6px");
  });

  it("非长度字段保持原值（不追加 px）", () => {
    const styles: ComponentStyles = {
      color: "#ff0000",
      background: "#f5f5f5",
      fontWeight: "bold",
      opacity: 0.5,
      lineHeight: 1.5,
    };
    const css = stylesToCss(styles);
    assert.strictEqual(css.color, "#ff0000");
    assert.strictEqual(css.background, "#f5f5f5");
    assert.strictEqual(css.fontWeight, "bold");
    assert.strictEqual(css.opacity, 0.5);
    assert.strictEqual(css.lineHeight, 1.5);
  });

  it("应跳过 undefined / null 字段", () => {
    const css = stylesToCss({ width: 10, color: undefined });
    assert.strictEqual(css.width, "10px");
    assert.ok(!("color" in css));
  });
});
