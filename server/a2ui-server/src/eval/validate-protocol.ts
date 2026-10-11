import { isCanonicalIconName } from "../tools/icon-registry";
import type { ScenarioExpect } from "./scenarios";

/**
 * 确定性 A2UI 协议校验器：
 * 输入一次 agent 运行产出的全部消息（已 parse 的对象）与场景期望，
 * 输出违规列表（空数组即通过）与统计信息。不调用模型、不做 I/O，
 * 因此可在常规单测中直接验证，也作为真实模型评测的评分器。
 */

export interface ValidationStats {
  messageCount: number;
  componentCount: number;
  typeCounts: Record<string, number>;
  actionNames: string[];
  dataPaths: string[];
  bindingPaths: string[];
  literals: string[];
  templateCount: number;
  dataModelCount: number;
  hasBeginRendering: boolean;
}

export interface ValidationResult {
  violations: string[];
  stats: ValidationStats;
}

/** 递归遍历的中间收集状态 */
interface Collector {
  componentIds: Set<string>;
  typeCounts: Record<string, number>;
  referencedIds: Set<string>;
  actionNames: Set<string>;
  dataPaths: Set<string>;
  bindingPaths: Set<string>;
  literals: string[];
  templateCount: number;
  /** Icon.name 为字面量时收集到的 canonical 名 */
  iconNames: Set<string>;
}

/** 拼接数据路径：join("/items", "0") → "/items/0"；join("/", "x") → "/x" */
function joinPath(baseRaw: string, keyRaw: string): string {
  const base = baseRaw.replace(/\/+$/, "");
  const key = keyRaw.replace(/^\/+/, "");
  return `${base}/${key}`;
}

/**
 * 通用递归遍历一个组件的 props 子树，按属性名收集：
 * literalString → 文本；path → 绑定；explicitList/child/template.componentId
 * → id 引用；children.template → 模板计数 + dataBinding；action.name → 动作名。
 * 不按组件类型分支，六个组件的属性命名一致即可全部覆盖。
 */
function walkValue(value: unknown, c: Collector): void {
  if (Array.isArray(value)) {
    for (const item of value) walkValue(item, c);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    switch (key) {
      case "literalString":
        if (typeof child === "string") c.literals.push(child);
        break;
      case "path":
        if (typeof child === "string") c.bindingPaths.add(child);
        break;
      case "child":
        if (typeof child === "string") c.referencedIds.add(child);
        break;
      case "explicitList":
        if (Array.isArray(child)) {
          for (const id of child) {
            if (typeof id === "string") c.referencedIds.add(id);
          }
        }
        break;
      case "template":
        if (child && typeof child === "object") {
          const t = child as { componentId?: unknown; dataBinding?: unknown };
          c.templateCount += 1;
          if (typeof t.componentId === "string") {
            c.referencedIds.add(t.componentId);
          }
          if (typeof t.dataBinding === "string") {
            c.bindingPaths.add(t.dataBinding);
          }
        }
        break;
      case "name":
        // 只收集 action.name（name 出现在 action 对象内；递归到 action
        // 子树时 key 为 "name"，其他位置目前无同名属性）
        if (typeof child === "string") c.actionNames.add(child);
        break;
      default:
        break;
    }
    walkValue(child, c);
  }
}

/** 处理单个组件定义 {id, component:{TYPE:props}} */
function collectComponent(
  item: unknown,
  supported: ReadonlySet<string>,
  c: Collector,
  violations: string[],
): void {
  if (typeof item !== "object" || item === null) {
    violations.push(
      `surfaceUpdate component entry is not an object: ${JSON.stringify(item)?.slice(0, 80)}`,
    );
    return;
  }
  const entry = item as { id?: unknown; component?: unknown };
  if (typeof entry.id !== "string") {
    violations.push("surfaceUpdate component entry missing string id");
    return;
  }
  if (typeof entry.component !== "object" || entry.component === null) {
    violations.push(`component ${entry.id} missing component object`);
    return;
  }
  const typeEntries = Object.entries(
    entry.component as Record<string, unknown>,
  );
  if (typeEntries.length !== 1) {
    violations.push(
      `component ${entry.id} must have exactly one type key, found ${typeEntries.length}`,
    );
    return;
  }
  const [type, props] = typeEntries[0];
  if (!supported.has(type)) {
    violations.push(
      `component ${entry.id} uses unsupported type "${type}" (renderer supports only Text/Row/Column/List/Button/TextField/Icon)`,
    );
  }

  // 协议允许同 id 被后续 surfaceUpdate 更新；计数以最终存在为准，
  // 首次出现才计入 typeCounts
  if (!c.componentIds.has(entry.id)) {
    c.componentIds.add(entry.id);
    c.typeCounts[type] = (c.typeCounts[type] ?? 0) + 1;
  }

  // Icon：收集字面量 canonical 名（path 绑定无法静态判定，跳过）
  if (type === "Icon") {
    const iconProps = props as {
      name?: { literalString?: string; path?: string };
    };
    if (typeof iconProps.name?.literalString === "string") {
      c.iconNames.add(iconProps.name.literalString);
    }
  }

  // 容器 children 必须二选一
  const containerProps = props as { children?: unknown };
  if (
    typeof containerProps.children === "object" &&
    containerProps.children !== null
  ) {
    const childrenObj = containerProps.children as Record<string, unknown>;
    const hasExplicit = "explicitList" in childrenObj;
    const hasTemplate = "template" in childrenObj;
    if (hasExplicit === hasTemplate) {
      violations.push(
        `component ${entry.id} children must contain exactly one of explicitList/template`,
      );
    }
  }

  walkValue(props, c);
}

/** 从 dataModelUpdate 收集覆盖路径（base + 每个 content key） */
function collectDataPaths(
  message: Record<string, unknown>,
  c: Collector,
): void {
  const update = message.dataModelUpdate as {
    path?: unknown;
    contents?: unknown;
  };
  const base = typeof update.path === "string" ? update.path : "/";
  c.dataPaths.add(base);
  const contents = update.contents;
  if (Array.isArray(contents)) {
    for (const rawEntry of contents) {
      const entry = rawEntry as { key?: unknown };
      if (typeof entry?.key === "string")
        c.dataPaths.add(joinPath(base, entry.key));
    }
  }
}

/** 判断数据路径是否被覆盖：精确命中或父子关系命中 */
function pathIsCovered(
  required: string,
  covered: ReadonlySet<string>,
): boolean {
  if (covered.has(required)) return true;
  for (const p of covered) {
    if (required.startsWith(`${p}/`)) return true;
    if (p.startsWith(`${required}/`)) return true;
  }
  return false;
}

/**
 * 校验一次 agent 运行的完整输出。
 * @param messages  agent 产出并 JSON.parse 后的消息数组（按产出顺序）
 * @param expect    场景期望
 * @param supported renderer 支持的组件类型集合（缺省取内置六种）
 */
export function validateA2UIOutput(
  messages: unknown[],
  expect: ScenarioExpect,
  supported: ReadonlySet<string> = new Set([
    "Text",
    "Row",
    "Column",
    "List",
    "Button",
    "TextField",
    "Icon",
  ]),
): ValidationResult {
  const violations: string[] = [];
  const c: Collector = {
    componentIds: new Set(),
    typeCounts: {},
    referencedIds: new Set(),
    actionNames: new Set(),
    dataPaths: new Set(),
    bindingPaths: new Set(),
    literals: [],
    templateCount: 0,
    iconNames: new Set(),
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      violations: ["agent produced no messages"],
      stats: emptyStats(0),
    };
  }

  const KNOWN_KINDS = new Set([
    "dataModelUpdate",
    "surfaceUpdate",
    "beginRendering",
  ]);
  let beginRenderingIndex = -1;
  let beginRoot: string | undefined;
  let dataModelCount = 0;
  let sawSurfaceUpdate = false;

  messages.forEach((rawMessage, index) => {
    if (typeof rawMessage !== "object" || rawMessage === null) {
      violations.push(`message #${index} is not an object`);
      return;
    }
    const message = rawMessage as Record<string, unknown>;
    const kinds = Object.keys(message).filter((key) => KNOWN_KINDS.has(key));
    const unknownKinds = Object.keys(message).filter(
      (key) => !KNOWN_KINDS.has(key),
    );
    if (kinds.length !== 1 || unknownKinds.length > 0) {
      violations.push(
        `message #${index} has invalid keys: [${Object.keys(message).join(", ")}]`,
      );
      return;
    }

    const surfaceId =
      (message.surfaceUpdate as { surfaceId?: unknown })?.surfaceId ??
      (message.dataModelUpdate as { surfaceId?: unknown })?.surfaceId ??
      (message.beginRendering as { surfaceId?: unknown })?.surfaceId;
    if (typeof surfaceId === "string" && surfaceId !== "main") {
      violations.push(
        `message #${index} targets surface "${surfaceId}", expected "main"`,
      );
    }

    if (message.surfaceUpdate) {
      sawSurfaceUpdate = true;
      const update = message.surfaceUpdate as { components?: unknown };
      if (!Array.isArray(update.components)) {
        violations.push(
          `message #${index} surfaceUpdate missing components array`,
        );
      } else {
        for (const item of update.components) {
          collectComponent(item, supported, c, violations);
        }
      }
    } else if (message.dataModelUpdate) {
      dataModelCount += 1;
      collectDataPaths(message, c);
    } else if (message.beginRendering) {
      if (beginRenderingIndex >= 0) {
        violations.push("beginRendering appears more than once");
      }
      beginRenderingIndex = index;
      beginRoot = (message.beginRendering as { root?: unknown }).root as
        | string
        | undefined;
    }
  });

  const partial = expect.partialUpdate === true;

  // ---- 结构性硬约束 ----
  if (!sawSurfaceUpdate && !partial)
    violations.push("output contains no surfaceUpdate message");
  if (beginRenderingIndex === -1) {
    violations.push("output contains no beginRendering message");
  } else {
    if (beginRenderingIndex !== messages.length - 1) {
      violations.push(
        `beginRendering must be the last message (found at index ${beginRenderingIndex}, total ${messages.length})`,
      );
    }
    // 增量轮：root 已存在于客户端，仅校验仍指向 "root"
    if (typeof beginRoot !== "string" || beginRoot !== "root") {
      violations.push(
        `beginRendering must keep root "root" (got "${beginRoot ?? ""}")`,
      );
    } else if (!partial && !c.componentIds.has(beginRoot)) {
      violations.push(
        `beginRendering root "${beginRoot}" does not exist among components`,
      );
    }
  }

  // 增量轮：补丁容器引用的未重定义 id 已在客户端存在，不做悬空检查
  if (!partial) {
    for (const id of c.referencedIds) {
      if (!c.componentIds.has(id)) {
        violations.push(`referenced component id "${id}" does not exist`);
      }
    }
  }

  // ---- 场景期望（oracle） ----
  const usedTypes = Object.keys(c.typeCounts);
  for (const type of expect.requiredComponents ?? []) {
    if (!usedTypes.includes(type)) {
      violations.push(`expected component type "${type}" is missing`);
    }
  }
  for (const type of expect.forbiddenComponents ?? []) {
    if (usedTypes.includes(type)) {
      violations.push(`forbidden component type "${type}" is present`);
    }
  }
  if (
    typeof expect.minComponents === "number" &&
    c.componentIds.size < expect.minComponents
  ) {
    violations.push(
      `expected at least ${expect.minComponents} components, found ${c.componentIds.size}`,
    );
  }
  if (expect.requireDataModel && dataModelCount === 0) {
    violations.push("expected at least one dataModelUpdate, none found");
  }
  if (expect.requireTemplateList && c.templateCount === 0) {
    violations.push(
      "expected at least one children.template dynamic list, none found",
    );
  }
  for (const action of expect.requiredActions ?? []) {
    if (!c.actionNames.has(action)) {
      violations.push(`expected action "${action}" is missing`);
    }
  }
  for (const path of expect.requiredDataPaths ?? []) {
    if (!pathIsCovered(path, c.dataPaths)) {
      violations.push(
        `data model path "${path}" is not covered by dataModelUpdate`,
      );
    }
  }
  for (const binding of expect.requiredBindings ?? []) {
    if (!c.bindingPaths.has(binding)) {
      violations.push(
        `expected binding "${binding}" is not referenced by any component`,
      );
    }
  }
  const joinedLiterals = c.literals.join("\n").toLowerCase();
  for (const literal of expect.requiredLiterals ?? []) {
    if (!joinedLiterals.includes(literal.toLowerCase())) {
      violations.push(`expected literal text "${literal}" is missing`);
    }
  }

  // Icon：字面量名必须已在图标注册表；requiredIcons 必须出现
  for (const iconName of c.iconNames) {
    if (!isCanonicalIconName(iconName)) {
      violations.push(
        `Icon "${iconName}" is not a registered canonical icon (call search_antd_icons to discover valid names)`,
      );
    }
  }
  for (const iconName of expect.requiredIcons ?? []) {
    if (!c.iconNames.has(iconName)) {
      violations.push(
        `expected icon "${iconName}" is not used by any Icon component`,
      );
    }
  }

  return {
    violations,
    stats: {
      messageCount: messages.length,
      componentCount: c.componentIds.size,
      typeCounts: c.typeCounts,
      actionNames: [...c.actionNames],
      dataPaths: [...c.dataPaths],
      bindingPaths: [...c.bindingPaths],
      literals: c.literals,
      templateCount: c.templateCount,
      dataModelCount,
      hasBeginRendering: beginRenderingIndex >= 0,
    },
  };
}

function emptyStats(messageCount: number): ValidationStats {
  return {
    messageCount,
    componentCount: 0,
    typeCounts: {},
    actionNames: [],
    dataPaths: [],
    bindingPaths: [],
    literals: [],
    templateCount: 0,
    dataModelCount: 0,
    hasBeginRendering: false,
  };
}
