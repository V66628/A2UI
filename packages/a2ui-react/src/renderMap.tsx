import { createElement } from "react";
import { resolveBinding, type RenderMap } from "@a2ui/core";
import { A2UIText } from "./components/Text.js";

/**
 * A2UI 组件类型 -> React 渲染函数
 * parser 解析 surfaceUpdate 时按组件类型调用对应 render，
 * 得到 ReactElement 放入 HydrateNode._vnode
 */
export const renderMap: RenderMap = {
  Text: (props, context) => {
    const textProps = props as {
      text?: { literalString?: string; path?: string };
      usageHint?: string;
    };
    const resolved = resolveBinding(textProps.text, context.dataModel);
    return createElement(A2UIText, {
      value: resolved === null || resolved === undefined ? "" : String(resolved),
      usageHint: textProps.usageHint,
    });
  },
};
