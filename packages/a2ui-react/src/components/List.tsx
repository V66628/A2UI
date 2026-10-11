import type { CSSProperties, ReactNode } from "react";
import type { ComponentStyles } from "@a2ui/core";
import { mergeStyles } from "../styles.js";

/** A2UI List 组件属性（renderMap 适配器解析后传入） */
export interface A2UIListProps {
  /**
   * 子元素惰性解析器：List 只负责布局，
   * 不做 "模板 / item -> vnode" 的解析，由 renderMap 适配器注入
   */
  resolveChildren?: () => ReactNode;
  /** 排列方向（默认纵向） */
  direction?: "vertical" | "horizontal";
  /** 交叉轴对齐：对应 CSS align-items */
  alignment?: "start" | "center" | "end" | "stretch";
  /** 组件级样式覆盖 */
  styles?: ComponentStyles;
}

/** 协议布局值 -> CSS 值 */
const ALIGN_ITEMS: Record<string, CSSProperties["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

/** A2UI List 的 React 渲染：纵向 / 横向 flex 布局，子项由数据驱动 */
export function A2UIList({
  resolveChildren,
  direction = "vertical",
  alignment,
  styles,
}: A2UIListProps) {
  const base: CSSProperties = {
    display: "flex",
    flexDirection: direction === "horizontal" ? "row" : "column",
    alignItems: alignment ? ALIGN_ITEMS[alignment] : undefined,
  };
  return (
    <div style={mergeStyles(base, styles)}>{resolveChildren?.() ?? null}</div>
  );
}
