import type { CSSProperties, ReactNode } from "react";

/** A2UI Button 组件属性（renderMap 适配器解析绑定后传入） */
export interface A2UIButtonProps {
  /** 子内容惰性解析器：按 child id 解析被引用组件（通常为 Text） */
  resolveChild?: () => ReactNode;
  /** 是否为主操作按钮（填充样式） */
  primary?: boolean;
  /** 点击回调（适配器内：解析 action.context → emitUserAction） */
  onClick?: () => void;
}

const BASE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 16px",
  borderRadius: 6,
  border: "1px solid #d9d9d9",
  background: "#fff",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: "22px",
};

const PRIMARY_STYLE: CSSProperties = {
  borderColor: "#1677ff",
  background: "#1677ff",
  color: "#fff",
};

/** A2UI Button 的 React 渲染：native button，不依赖组件库 */
export function A2UIButton({ resolveChild, primary, onClick }: A2UIButtonProps) {
  return (
    <button
      type="button"
      style={primary ? { ...BASE_STYLE, ...PRIMARY_STYLE } : BASE_STYLE}
      onClick={onClick}
    >
      {resolveChild?.() ?? null}
    </button>
  );
}
