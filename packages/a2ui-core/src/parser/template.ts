import type { HydrateNode } from "../store/types.js";
import type { ParseContext } from "./context.js";
import { splitPath } from "./data-model.js";
import { getPathValue } from "./binding.js";
import {
  getEngineHooks,
  getMountNotifier,
  getRenderMap,
} from "./render-registry.js";

/**
 * children.template：数据驱动动态子项（见 standard_catalog_definition.json）
 * - dataBinding：数据模型中被绑定列表 / map 的路径（如 "/members"）
 * - componentId：作为每个子项模板的组件 id（flat buffer 中的另一个组件）
 */
export interface ChildrenTemplate {
  componentId: string;
  dataBinding: string;
}

/**
 * 从容器组件 props 中提取 children.template；
 * 结构不完整（缺字段 / 类型错）时返回 undefined。
 */
export function extractTemplate(props: unknown): ChildrenTemplate | undefined {
  const raw = (
    props as { children?: { template?: unknown } } | null
  )?.children?.template as
    | { componentId?: unknown; dataBinding?: unknown }
    | undefined;
  if (
    raw &&
    typeof raw.componentId === "string" &&
    typeof raw.dataBinding === "string"
  ) {
    return { componentId: raw.componentId, dataBinding: raw.dataBinding };
  }
  return undefined;
}

/** 在协议原文中找到指定组件 id 的类型与 props */
export function findProtocolComponent(
  rawLine: string,
  componentId: string,
): { type: string; componentProps: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return null;
  }
  const body = (
    parsed as {
      surfaceUpdate?: {
        components?: Array<{
          id: string;
          component?: Record<string, unknown>;
        }>;
      };
    }
  ).surfaceUpdate;
  const item = body?.components?.find((entry) => entry.id === componentId);
  if (!item || !item.component) return null;
  const typeKeys = Object.keys(item.component);
  if (typeKeys.length !== 1) return null;
  return {
    type: typeKeys[0],
    componentProps: item.component[typeKeys[0]],
  };
}

/** 模板子项的一次渲染产物 */
export interface TemplateChild {
  key: string;
  vnode: unknown;
}

/**
 * 按 item 作用域递归渲染模板组件：
 * 模板组件（及其通过 child / children.explicitList 引用的后代）一律以当前 item
 * 为数据模型根，绑定路径相对 item 解析（协议：“item's data is made available
 * to the template component for relative data binding”）。
 */
function renderScoped(args: {
  ctx: ParseContext;
  surfaceId: string;
  componentId: string;
  scopeModel: unknown;
  basePath: string;
  itemKey: string;
}): unknown {
  const { ctx, surfaceId, componentId, scopeModel, basePath, itemKey } = args;

  const tplNode = ctx.nodeMap.get(surfaceId)?.get(componentId);
  if (!tplNode) return null;
  const found = findProtocolComponent(tplNode.protocol, componentId);
  if (!found) return null;
  const render = getRenderMap()?.[found.type];
  if (!render) return null;

  // 同一 item 内的引用环保护（resolveNode 惰性调用，共享一个集合）
  const visiting = new Set<string>();

  return render(found.componentProps, {
    componentId,
    nodeToken: tplNode.nodeToken,
    ownerSurfaceId: surfaceId,
    dataModel: scopeModel as Record<string, unknown>,
    protocol: tplNode.protocol,
    resolveNode: (refId) => {
      if (visiting.has(refId)) return null;
      visiting.add(refId);
      return {
        _vnode: renderScoped({ ...args, componentId: refId }),
      } as HydrateNode;
    },
    hasMounted: tplNode.hasMounted,
    markMounted: () => {
      if (tplNode.hasMounted) return;
      tplNode.hasMounted = true;
      getMountNotifier()?.(componentId);
    },
    writeDataModel: (relativePath, value) => {
      // 相对写路径映射到 surface 绝对路径：/members/0/name
      const segments = [
        ...splitPath(basePath),
        itemKey,
        ...splitPath(relativePath),
      ];
      getEngineHooks()?.commitLocalWrite(
        surfaceId,
        `/${segments.join("/")}`,
        value,
      );
    },
    emitUserAction: (name, context) =>
      getEngineHooks()?.dispatchUserAction(
        surfaceId,
        componentId,
        name,
        context,
      ),
  });
}

/**
 * 渲染容器 children.template 的全部子项：
 * - dataBinding 处为数组：按下标迭代；
 * - 为对象（valueMap 展开结果）：按 key 顺序迭代 values；
 * - 其他类型：无子项。
 * 模板组件缺失 / 未注册 / 渲染返回空的子项被跳过。
 */
export function renderTemplateChildren(
  ctx: ParseContext,
  surfaceId: string,
  surfaceModel: Record<string, unknown> | undefined,
  template: ChildrenTemplate,
): TemplateChild[] {
  const bound = getPathValue(template.dataBinding, surfaceModel);

  let entries: Array<[string, unknown]>;
  if (Array.isArray(bound)) {
    entries = bound.map((item, index) => [String(index), item]);
  } else if (typeof bound === "object" && bound !== null) {
    entries = Object.entries(bound as Record<string, unknown>);
  } else {
    entries = [];
  }

  const children: TemplateChild[] = [];
  for (const [key, item] of entries) {
    const vnode = renderScoped({
      ctx,
      surfaceId,
      componentId: template.componentId,
      scopeModel: item,
      basePath: template.dataBinding,
      itemKey: key,
    });
    if (vnode !== null && vnode !== undefined) children.push({ key, vnode });
  }
  return children;
}
