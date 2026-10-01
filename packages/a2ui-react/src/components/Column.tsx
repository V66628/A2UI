import type { CSSProperties, ReactNode } from "react";

/** A2UI Column 组件属性（renderMap 适配器解析后传入） */
export interface A2UIColumnProps {
  /**
   * 子元素惰性解析器：Column 只负责布局，
   * 不做 "组件 id -> vnode" 的解析，由 renderMap 适配器注入
   */
  resolveChildren?: () => ReactNode;
  /** 主轴（纵向）分布：对应 CSS justify-content */
  distribution?:
    | "start"
    | "center"
    | "end"
    | "spaceBetween"
    | "spaceAround"
    | "spaceEvenly";
  /** 交叉轴（横向）对齐：对应 CSS align-items */
  alignment?: "start" | "center" | "end" | "stretch";
}

/** 协议布局值 -> CSS 值 */
const JUSTIFY_CONTENT: Record<string, CSSProperties["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
};
const ALIGN_ITEMS: Record<string, CSSProperties["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

/** A2UI Column 的 React 渲染：纵向 flex 布局容器 */
export function A2UIColumn({
  resolveChildren,
  distribution,
  alignment,
}: A2UIColumnProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: distribution
          ? JUSTIFY_CONTENT[distribution]
          : undefined,
        alignItems: alignment ? ALIGN_ITEMS[alignment] : undefined,
      }}
    >
      {resolveChildren?.() ?? null}
    </div>
  );
}
