import type { TypedValueBinding } from "./binding.js";

/**
 * Button（及其他可触发 action 的组件）的本地更新指令。
 *
 * A2UI 0.8 协议扩展：标准 action 只向 server 派发 userAction，
 * 不支持由交互直接更新本地数据模型。当 action 携带 localUpdate 时，
 * client 不发送 userAction，而是在本地模拟一条 dataModelUpdate：
 * 把 `value`（类型化值绑定，点击时解析）深写到 `path`，
 * parser 随后以最新数据模型重渲染——即“本地更新”类型的交互。
 */
export interface LocalUpdate {
  /** 写入路径（相对当前 surface 根，如 "/message"） */
  path: string;
  /** 写入值：字面量（string/number/boolean）或引用 dataModel 的 path */
  value: TypedValueBinding;
}

/**
 * 从组件的 action 中提取并校验 localUpdate。
 * 合法（path 为非空字符串、value 为对象）时返回 LocalUpdate；
 * 无 localUpdate / 字段非法时返回 undefined（按普通 server action 处理）。
 */
export function extractLocalUpdate(action: unknown): LocalUpdate | undefined {
  if (typeof action !== "object" || action === null) return undefined;
  const raw = (action as { localUpdate?: unknown }).localUpdate;
  if (typeof raw !== "object" || raw === null) return undefined;

  const { path, value } = raw as { path?: unknown; value?: unknown };
  if (typeof path !== "string" || path.trim() === "") return undefined;
  if (typeof value !== "object" || value === null) return undefined;

  return { path, value: value as TypedValueBinding };
}
