import type { ComponentStyles } from "./types.js";

/**
 * 将协议 ComponentStyles 转换为 CSS 属性 -> 值的扁平记录，
 * 键使用 React 内联样式的 camelCase 形式，可直接作为 style 使用。
 *
 * 这里是协议字段 -> CSS 属性的唯一映射处；所有数值类长度单位为 px。
 */

/** 需要追加 px 单位的字段 */
const PX_UNIT_FIELDS = new Set<keyof ComponentStyles>([
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontSize",
  "borderRadius",
]);

export function stylesToCss(
  styles?: ComponentStyles,
): Record<string, string | number> {
  if (!styles) return {};
  const out: Record<string, string | number> = {};
  for (const key of Object.keys(styles) as Array<keyof ComponentStyles>) {
    const value = styles[key];
    if (value === undefined || value === null) continue;
    out[key] =
      PX_UNIT_FIELDS.has(key) && typeof value === "number"
        ? `${value}px`
        : value;
  }
  return out;
}
