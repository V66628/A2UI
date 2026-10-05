import type { Surface } from "../store/types.js";
import { getPathValue } from "./binding.js";
import { extractEntryValue } from "./context.js";

/**
 * 数据模型纯逻辑：
 * - dataModelUpdate 的应用（path 省略/"/" 整替换；嵌套路径深写合并）
 * - 本地乐观写入（TextField 等 path 绑定输入）
 *
 * 写入沿路径产生新容器引用并回写 surface.dataModel，替换语义明确。
 */

/** 切分数据模型路径：`/a/b` → ["a","b"]；空 / "/"/ undefined → [] */
export function splitPath(path?: string): string[] {
  if (!path) return [];
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** contents 条目数组 → 键值对象（非法条目跳过；valueMap 经 extractEntryValue 递归展开） */
export function buildContentsObject(contents: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rawEntry of contents) {
    if (
      typeof rawEntry !== "object" ||
      rawEntry === null ||
      typeof (rawEntry as { key?: unknown }).key !== "string"
    ) {
      continue;
    }
    const entry = rawEntry as Record<string, unknown> & { key: string };
    result[entry.key] = extractEntryValue(entry);
  }
  return result;
}

/**
 * 沿路径不可变深写：返回写入后的新根容器。
 * 容器为数组且段为数字时按数组下标写入；缺失容器按对象创建。
 */
function cloneSet(
  root: unknown,
  segments: string[],
  value: unknown,
): Record<string, unknown> | unknown[] {
  const [head, ...rest] = segments;
  const nextChild =
    rest.length === 0
      ? value
      : cloneSet(
          (root as Record<string, unknown> | null)?.[head],
          rest,
          value,
        );
  if (Array.isArray(root)) {
    const cloned = [...root];
    cloned[Number(head)] = nextChild;
    return cloned;
  }
  return { ...((root as Record<string, unknown> | null) ?? {}), [head]: nextChild };
}

/**
 * 应用 dataModelUpdate：
 * - path 省略/"/"：整个数据模型替换为 contents 构建的新对象；
 * - 嵌套路径：定位（缺失/非对象的中间容器重建为对象），在目标位置合并
 *   contents 各 key→value；路径沿线产生新引用。
 */
export function applyDataModelUpdate(
  surface: Surface,
  rawPath: unknown,
  contents: unknown[],
): void {
  const segments =
    typeof rawPath === "string" ? splitPath(rawPath) : [];
  const incoming = buildContentsObject(contents);

  if (segments.length === 0) {
    surface.dataModel = incoming;
    return;
  }

  const parentSegments = segments.slice(0, -1);
  const targetSegment = segments[segments.length - 1];
  const currentTarget = getPathValue(
    segments.join("/"),
    surface.dataModel,
  );
  const mergedTarget: Record<string, unknown> =
    typeof currentTarget === "object" &&
    currentTarget !== null &&
    !Array.isArray(currentTarget)
      ? { ...(currentTarget as Record<string, unknown>), ...incoming }
      : incoming;

  surface.dataModel = cloneSet(
    surface.dataModel,
    [...parentSegments, targetSegment],
    mergedTarget,
  ) as Record<string, unknown>;
}

/**
 * 本地乐观写入：按 path 深写一个值，回写 surface.dataModel（沿线新引用）。
 * path 为空时仅当 value 为对象才替换根，否则忽略。
 */
export function commitLocalWrite(
  surface: Surface,
  path: string,
  value: unknown,
): void {
  const segments = splitPath(path);
  if (segments.length === 0) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      surface.dataModel = value as Record<string, unknown>;
    }
    return;
  }
  surface.dataModel = cloneSet(surface.dataModel, segments, value) as Record<
    string,
    unknown
  >;
}
