import {
  cloneElement,
  createElement,
  type ComponentType,
  type ReactElement,
} from "react";
import {
  extractLocalUpdate,
  extractTemplate,
  resolveBinding,
  resolveValueBinding,
  type ChildrenTemplate,
  type RenderContext,
  type RenderMap,
  type TypedValueBinding,
} from "@a2ui/core";
import { A2UIButton } from "./components/Button.js";
import { A2UIList } from "./components/List.js";
import { MountFade } from "./components/MountFade.js";
import { A2UIText } from "./components/Text.js";
import { A2UIColumn, type A2UIColumnProps } from "./components/Column.js";
import { A2UIRow, type A2UIRowProps } from "./components/Row.js";
import { A2UITextField, type TextFieldKind } from "./components/TextField.js";

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
  List: (props, context) => {
    const listProps = props as {
      direction?: "vertical" | "horizontal";
      alignment?: "start" | "center" | "end" | "stretch";
      children?: { explicitList?: string[]; template?: unknown };
    };
    return withMountFade(
      createElement(A2UIList, {
        direction: listProps.direction,
        alignment: listProps.alignment,
        resolveChildren: () =>
          resolveContainerChildren(
            listProps.children?.explicitList ?? [],
            extractTemplate(listProps),
            context,
          ),
      }),
      context,
    );
  },

  Button: (props, context) => {
    const buttonProps = props as {
      child?: string;
      primary?: boolean;
      action?: {
        name: string;
        context?: Array<{ key: string; value?: TypedValueBinding }>;
      };
    };
    return withMountFade(
      createElement(A2UIButton, {
        primary: buttonProps.primary,
        // 惰性解析 child 引用（通常为 Text）
        resolveChild: () => {
          const childId = buttonProps.child;
          if (!childId) return null;
          const childVnode = context.resolveNode?.(childId)?._vnode;
          return childVnode
            ? cloneElement(childVnode as ReactElement, { key: childId })
            : null;
        },
        onClick: () => {
          const action = buttonProps.action;
          if (!action) return;
          // 本地更新类型：不派发 userAction，在本地模拟 dataModelUpdate
          const localUpdate = extractLocalUpdate(action);
          if (localUpdate) {
            const nextValue = resolveValueBinding(
              localUpdate.value,
              context.dataModel,
            );
            context.writeDataModel?.(localUpdate.path, nextValue);
            return;
          }
          // 默认：向 server 派发 userAction
          // 用点击时 context 中的最新模型解析 context 绑定
          const resolved: Record<string, unknown> = {};
          for (const item of action.context ?? []) {
            resolved[item.key] = resolveValueBinding(
              item.value,
              context.dataModel,
            );
          }
          context.emitUserAction?.(action.name, resolved);
        },
      }),
      context,
    );
  },

  TextField: (props, context) => {
    const fieldProps = props as {
      label?: TypedValueBinding;
      text?: TypedValueBinding;
      textFieldType?: TextFieldKind;
    };
    const resolvedValue = resolveValueBinding(
      fieldProps.text,
      context.dataModel,
    );
    const resolvedLabel = resolveValueBinding(
      fieldProps.label,
      context.dataModel,
    );
    return withMountFade(
      createElement(A2UITextField, {
        label:
          resolvedLabel === null || resolvedLabel === undefined
            ? undefined
            : String(resolvedLabel),
        value:
          resolvedValue === null || resolvedValue === undefined
            ? ""
            : String(resolvedValue),
        fieldType: fieldProps.textFieldType,
        onChange: (next) => {
          // 仅 path 绑定可写；字面量绑定只读
          const path = fieldProps.text?.path;
          if (path) context.writeDataModel?.(path, next);
        },
      }),
      context,
    );
  },
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
  children?: { explicitList?: string[]; template?: unknown };
};

/**
 * 解析容器的子元素：
 * - children.template：经 context.resolveTemplate 按 item 作用域渲染动态子项；
 * - children.explicitList：按 id 惰性解析已注册子节点。
 * 用 cloneElement 补 key，避免列表子元素缺少 key 警告。
 */
function resolveContainerChildren(
  childIds: string[],
  template: ChildrenTemplate | undefined,
  context: RenderContext,
) {
  if (template) {
    const items = context.resolveTemplate?.(template) ?? [];
    return items.map((entry) =>
      entry.vnode
        ? cloneElement(entry.vnode as ReactElement, { key: entry.key })
        : null,
    );
  }
  return childIds.map((id) => {
    const childVnode = context.resolveNode?.(id)?._vnode;
    return childVnode
      ? cloneElement(childVnode as ReactElement, { key: id })
      : null;
  });
}

/**
 * 为布局容器组件（Column / Row）创建 render 适配器：
 * 支持 children.explicitList（静态）与 children.template（数据驱动）。
 */
function createLayoutRenderer(
  Component: ComponentType<A2UIColumnProps | A2UIRowProps>,
): NonNullable<RenderMap[keyof RenderMap]> {
  return (props, context) => {
    const layoutProps = props as LayoutProps;
    return withMountFade(
      createElement(Component, {
        distribution: layoutProps.distribution,
        alignment: layoutProps.alignment,
        // 惰性解析：组件实际 render 时子节点 / item 模板已就绪
        resolveChildren: () =>
          resolveContainerChildren(
            layoutProps.children?.explicitList ?? [],
            extractTemplate(layoutProps),
            context,
          ),
      }),
      context,
    );
  };
}
