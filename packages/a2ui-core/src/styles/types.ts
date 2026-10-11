/**
 * 组件级 styles（A2UI 扩展）
 *
 * 每个原子组件都可以携带一个 `styles` 对象，用来在语义化 props
 * （distribution / alignment / usageHint …）之外覆盖具体的视觉样式。
 * 所有字段可选、单位为 px（与渲染器实现解耦，协议层不直接出现 CSS）。
 */
export interface ComponentStyles {
  /* ---- 尺寸 ---- */
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  /* ---- 外边距 ---- */
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;

  /* ---- 内边距 ---- */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;

  /* ---- 字体 ---- */
  fontSize?: number;
  fontWeight?: number | "normal" | "bold";
  lineHeight?: number;
  color?: string;

  /* ---- 背景 / 边框 / 圆角 ---- */
  background?: string;
  borderColor?: string;
  borderRadius?: number;

  /* ---- 其他 ---- */
  opacity?: number;
}

/** 组件 props 中 styles 字段的类型（所有原子组件通用） */
export interface WithStyles {
  styles?: ComponentStyles;
}
