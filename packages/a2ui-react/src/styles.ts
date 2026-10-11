import type { CSSProperties } from "react";
import { stylesToCss, type ComponentStyles } from "@a2ui/core";

/**
 * 合并基础样式与协议 styles。
 * styles 优先级最高（放在最后展开），用来覆盖语义化 props 生成的默认样式。
 */
export function mergeStyles(
  base: CSSProperties | undefined,
  styles?: ComponentStyles,
): CSSProperties {
  return { ...(base ?? {}), ...stylesToCss(styles) };
}
