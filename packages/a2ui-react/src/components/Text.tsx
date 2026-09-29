import type { CSSProperties } from "react";

/** A2UI Text 组件属性（renderMap 适配器解析绑定后传入） */
export interface A2UITextProps {
  /** 已解析的文本内容 */
  value: string;
  /** 协议中的样式语义提示：h1~h5 / caption / body */
  usageHint?: string;
}

/** usageHint -> 基础样式 */
const USAGE_HINT_STYLES: Record<string, CSSProperties> = {
  h1: { fontSize: 32, fontWeight: 700 },
  h2: { fontSize: 28, fontWeight: 700 },
  h3: { fontSize: 24, fontWeight: 700 },
  h4: { fontSize: 20, fontWeight: 700 },
  h5: { fontSize: 16, fontWeight: 700 },
  caption: { fontSize: 12, color: "#666" },
  body: { fontSize: 14 },
};

/** A2UI Text 的 React 渲染 */
export function A2UIText({ value, usageHint }: A2UITextProps) {
  return <span style={usageHint ? USAGE_HINT_STYLES[usageHint] : undefined}>{value}</span>;
}
