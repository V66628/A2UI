/** a2ui 值绑定：字面量或数据模型路径引用 */
export interface ValueBinding {
  literalString?: string;
  path?: string;
}

/**
 * 解析数据模型路径（如 "/user/name" 或 "user.name"）
 * 路径不存在时返回 undefined
 */
export function getPathValue(
  path: string,
  dataModel?: Record<string, unknown>,
): unknown {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current: unknown = dataModel;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * 解析 a2ui 值绑定：
 * - 含 literalString 时直接返回字面量
 * - 含 path 时从数据模型中取值
 */
export function resolveBinding(
  binding: ValueBinding | undefined,
  dataModel?: Record<string, unknown>,
): unknown {
  if (!binding) return null;
  if (binding.literalString !== undefined) return binding.literalString;
  if (binding.path !== undefined) return getPathValue(binding.path, dataModel);
  return null;
}

/**
 * 类型化值绑定（如 Button.action.context 的 value、CheckBox.value）：
 * 除字符串字面量与 path 外，还支持数字 / 布尔字面量。
 */
export interface TypedValueBinding extends ValueBinding {
  literalNumber?: number;
  literalBoolean?: boolean;
}

/**
 * 解析类型化值绑定：按 literalString → literalNumber → literalBoolean → path
 * 的优先级返回（协议上每条绑定只会出现一个字段）。
 */
export function resolveValueBinding(
  binding: TypedValueBinding | undefined,
  dataModel?: Record<string, unknown>,
): unknown {
  if (!binding) return null;
  if (binding.literalString !== undefined) return binding.literalString;
  if (binding.literalNumber !== undefined) return binding.literalNumber;
  if (binding.literalBoolean !== undefined) return binding.literalBoolean;
  if (binding.path !== undefined) return getPathValue(binding.path, dataModel);
  return null;
}
