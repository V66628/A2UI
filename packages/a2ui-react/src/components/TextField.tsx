import type { CSSProperties } from "react";

/** 协议 textFieldType → 输入形态 */
export type TextFieldKind =
  | "shortText"
  | "longText"
  | "obscured"
  | "number"
  | "date"
  | undefined;

/** A2UI TextField 组件属性（renderMap 适配器解析绑定后传入） */
export interface A2UITextFieldProps {
  /** 已解析的标签文本 */
  label?: string;
  /** 已解析的当前值（受控） */
  value: string;
  /** 协议中的输入类型提示 */
  fieldType?: TextFieldKind;
  /** 值变化回调（适配器内：path 绑定则 writeDataModel） */
  onChange: (next: string) => void;
}

const INPUT_STYLE: CSSProperties = {
  padding: "4px 11px",
  border: "1px solid #d9d9d9",
  borderRadius: 6,
  fontSize: 14,
  lineHeight: "22px",
};

const LABEL_STYLE: CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontSize: 14,
};

/** A2UI TextField 的 React 渲染：label + input（longText 为 textarea） */
export function A2UITextField({
  label,
  value,
  fieldType,
  onChange,
}: A2UITextFieldProps) {
  const labelNode = label ? (
    <label style={LABEL_STYLE}>{label}</label>
  ) : null;

  if (fieldType === "longText") {
    return (
      <div>
        {labelNode}
        <textarea
          style={{ ...INPUT_STYLE, minHeight: 80 }}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  // obscured → password；number → number；date → date；其余短文本
  const inputType =
    fieldType === "obscured"
      ? "password"
      : fieldType === "number"
        ? "number"
        : fieldType === "date"
          ? "date"
          : "text";

  return (
    <div>
      {labelNode}
      <input
        style={INPUT_STYLE}
        type={inputType}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
