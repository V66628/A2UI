import {
  cloneElement,
  createElement,
  type ComponentType,
  type ReactElement,
} from "react";
import { resolveBinding, type RenderContext, type RenderMap } from "@a2ui/core";
import { MountFade } from "./components/MountFade.js";
import { A2UIText } from "./components/Text.js";
import { A2UIColumn, type A2UIColumnProps } from "./components/Column.js";
import { A2UIRow, type A2UIRowProps } from "./components/Row.js";

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
    return withMountFade(
      createElement(A2UIText, {
        value:
          resolved === null || resolved === undefined ? "" : String(resolved),
        usageHint: textProps.usageHint,
      }),
      context,
    );
  },

  Column: createLayoutRenderer(A2UIColumn),
  Row: createLayoutRenderer(A2UIRow),
};

/**
 * 为渲染出的节点包一层 MountFade：
 * parser 标记为未挂载（hasMounted=false）的新组件播放 0.3s 淡入，
 * 动画结束经 context.markMounted 回写 store。
 */
function withMountFade(
  vnode: ReactElement,
  context: RenderContext,
): ReactElement {
  return createElement(MountFade, {
    key: context.componentId,
    nodeToken: context.nodeToken,
    componentId: context.componentId,
    hasMounted: context.hasMounted,
    onFadeEnd: context.markMounted,
    children: vnode,
  });
}

/** 布局容器（Column / Row）的协议 props，二者结构一致 */
type LayoutProps = Pick<A2UIColumnProps, "distribution" | "alignment"> & {
  children?: { explicitList?: string[] };
};

/**
 * 为布局容器组件（Column / Row）创建 render 适配器：
 * 读取 children.explicitList 中的子组件 id，注入惰性 resolveChildren。
 */
function createLayoutRenderer(
  Component: ComponentType<A2UIColumnProps | A2UIRowProps>,
): NonNullable<RenderMap[keyof RenderMap]> {
  return (props, context) => {
    const layoutProps = props as LayoutProps;
    // 子组件 id 引用（explicitList）；子组件已在 parser 两阶段流程中注册
    const childIds = layoutProps.children?.explicitList ?? [];
    return withMountFade(
      createElement(Component, {
        distribution: layoutProps.distribution,
        alignment: layoutProps.alignment,
        // 惰性解析：组件实际 render 时子节点 _vnode 已就绪；
        // 用 cloneElement 补 key，避免列表子元素缺少 key 警告
        resolveChildren: () =>
          childIds.map((id) => {
            const childVnode = context.resolveNode?.(id)?._vnode;
            return childVnode
              ? cloneElement(childVnode as ReactElement, { key: id })
              : null;
          }),
      }),
      context,
    );
  };
}
