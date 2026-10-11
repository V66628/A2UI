/**
 * A2UI v0.8 标准合规校验（轻量结构校验，无 JSON Schema 依赖）。
 *
 * 对照规范：specification/json/server_to_client_with_standard_catalog.json
 * 每条 JSONL 消息必须且只能包含一个动作：
 *   beginRendering / surfaceUpdate / dataModelUpdate / deleteSurface
 *
 * 校验结论分两级：
 *   - error：违反 v0.8 强制规则（未知动作/组件/字段、缺必填、类型不符、枚举越界等）
 *   - extension：不属于 v0.8 标准、但本项目渲染器支持的方言扩展
 *     （目前主要是组件级 styles：标准里 styles 只允许出现在 beginRendering，
 *     且仅含 font / primaryColor 两个字段）
 */

export type ComplianceStatus = "valid" | "extension" | "invalid";

export interface ComplianceIssue {
  level: "error" | "extension";
  /** 定位路径，如 surfaceUpdate.components[2].component.Button.action */
  path: string;
  message: string;
}

export interface LineCompliance {
  lineNo: number;
  raw: string;
  /** 该行动作类型；解析失败或结构缺失时为 null */
  action: string | null;
  status: ComplianceStatus;
  issues: ComplianceIssue[];
}

export interface ComplianceReport {
  lines: LineCompliance[];
  totals: { total: number; valid: number; extension: number; invalid: number };
}

/** 标准动作 */
const ACTION_KEYS = [
  "beginRendering",
  "surfaceUpdate",
  "dataModelUpdate",
  "deleteSurface",
] as const;

/** 属性值形态 */
type PropKind =
  | "string"
  | "boolean"
  | "number"
  | "integer"
  | "valueObject" // { literalString } 或 { path }，恰好一个键
  | "children" // { explicitList: string[] } 或 { template: object }
  | "childId" // 子组件 id 字符串（Card.child / Button.child）
  | "action" // { name: string, context?: ... }
  | "objectArray" // 对象数组（tabItems / options），逐项结构不做深校验
  | "object"; // 其余对象（数据绑定 value / selections 等），不做深校验

interface ComponentSpec {
  required: string[];
  props: Record<string, PropKind | `enum:${string}`>;
}

/** v0.8 标准目录：19 个组件及其属性白名单（additionalProperties: false） */
const COMPONENT_SPECS: Record<string, ComponentSpec> = {
  Text: {
    required: ["text"],
    props: { text: "valueObject", usageHint: "enum:Text.usageHint" },
  },
  Image: {
    required: ["url"],
    props: {
      url: "valueObject",
      altText: "valueObject",
      fit: "enum:Image.fit",
      usageHint: "enum:Image.usageHint",
    },
  },
  Icon: { required: ["name"], props: { name: "valueObject" } },
  Video: { required: ["url"], props: { url: "valueObject" } },
  AudioPlayer: {
    required: ["url"],
    props: { url: "valueObject", description: "valueObject" },
  },
  Row: {
    required: ["children"],
    props: {
      children: "children",
      distribution: "enum:Row.distribution",
      alignment: "enum:Row.alignment",
    },
  },
  Column: {
    required: ["children"],
    props: {
      children: "children",
      distribution: "enum:Column.distribution",
      alignment: "enum:Column.alignment",
    },
  },
  List: {
    required: ["children"],
    props: {
      children: "children",
      direction: "enum:List.direction",
      alignment: "enum:List.alignment",
    },
  },
  Card: { required: ["child"], props: { child: "childId" } },
  Tabs: { required: ["tabItems"], props: { tabItems: "objectArray" } },
  Divider: { required: [], props: { axis: "enum:Divider.axis" } },
  Modal: {
    required: ["entryPointChild", "contentChild"],
    props: { entryPointChild: "childId", contentChild: "childId" },
  },
  Button: {
    required: ["child", "action"],
    props: { child: "childId", primary: "boolean", action: "action" },
  },
  CheckBox: {
    required: ["label", "value"],
    props: { label: "valueObject", value: "object" },
  },
  TextField: {
    required: ["label"],
    props: {
      label: "valueObject",
      text: "valueObject",
      textFieldType: "enum:TextField.textFieldType",
      validationRegexp: "string",
    },
  },
  DateTimeInput: {
    required: ["value"],
    props: {
      value: "object",
      enableDate: "boolean",
      enableTime: "boolean",
    },
  },
  MultipleChoice: {
    required: ["selections", "options"],
    props: {
      selections: "object",
      options: "objectArray",
      maxAllowedSelections: "integer",
    },
  },
  Slider: {
    required: ["value"],
    props: {
      label: "valueObject",
      value: "object",
      minValue: "number",
      maxValue: "number",
    },
  },
};

/** 标准枚举值 */
const ENUMS: Record<string, string[]> = {
  "Text.usageHint": ["h1", "h2", "h3", "h4", "h5", "caption", "body"],
  "Image.fit": ["contain", "cover", "fill", "none", "scale-down"],
  "Image.usageHint": [
    "icon",
    "avatar",
    "smallFeature",
    "mediumFeature",
    "largeFeature",
    "header",
  ],
  "Row.distribution": [
    "center",
    "end",
    "spaceAround",
    "spaceBetween",
    "spaceEvenly",
    "start",
  ],
  "Row.alignment": ["start", "center", "end", "stretch"],
  "Column.distribution": [
    "start",
    "center",
    "end",
    "spaceBetween",
    "spaceAround",
    "spaceEvenly",
  ],
  "Column.alignment": ["center", "end", "start", "stretch"],
  "List.direction": ["vertical", "horizontal"],
  "List.alignment": ["start", "center", "end", "stretch"],
  "Divider.axis": ["horizontal", "vertical"],
  "TextField.textFieldType": [
    "date",
    "longText",
    "number",
    "shortText",
    "obscured",
  ],
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 校验 { literalString } | { path } 值对象 */
function checkValueObject(
  value: unknown,
  path: string,
  issues: ComplianceIssue[],
): void {
  if (!isObject(value)) {
    issues.push({
      level: "error",
      path,
      message: "应为 { literalString } 或 { path } 值对象，不能是裸字符串",
    });
    return;
  }
  const keys = Object.keys(value);
  const known = keys.filter((k) => k === "literalString" || k === "path");
  const unknown = keys.filter((k) => k !== "literalString" && k !== "path");
  if (unknown.length > 0) {
    issues.push({
      level: "error",
      path,
      message: `值对象含未知字段：${unknown.join(", ")}（仅允许 literalString / path）`,
    });
  }
  if (known.length !== 1 || unknown.length > 0) {
    if (known.length === 0) {
      issues.push({
        level: "error",
        path,
        message: "值对象必须包含 literalString 或 path 之一",
      });
    } else if (unknown.length === 0 && known.length > 1) {
      issues.push({
        level: "error",
        path,
        message: "literalString 与 path 互斥，只能出现一个",
      });
    }
  } else {
    const key = known[0];
    if (typeof value[key] !== "string") {
      issues.push({
        level: "error",
        path: `${path}.${key}`,
        message: `${key} 必须是字符串`,
      });
    }
  }
}

function checkChildren(
  value: unknown,
  path: string,
  issues: ComplianceIssue[],
): void {
  if (!isObject(value)) {
    issues.push({
      level: "error",
      path,
      message: "应为 { explicitList: string[] } 或 { template: {...} }",
    });
    return;
  }
  const keys = Object.keys(value);
  const unknown = keys.filter((k) => k !== "explicitList" && k !== "template");
  if (unknown.length > 0) {
    issues.push({
      level: "error",
      path,
      message: `children 含未知字段：${unknown.join(", ")}`,
    });
  }
  if (!keys.includes("explicitList") && !keys.includes("template")) {
    issues.push({
      level: "error",
      path,
      message: "children 必须包含 explicitList 或 template",
    });
  }
  if (keys.includes("explicitList")) {
    const list = value.explicitList;
    if (!Array.isArray(list) || list.some((item) => typeof item !== "string")) {
      issues.push({
        level: "error",
        path: `${path}.explicitList`,
        message: "explicitList 必须是组件 id 字符串数组",
      });
    }
  }
}

function checkProp(
  kind: PropKind | `enum:${string}`,
  value: unknown,
  path: string,
  issues: ComplianceIssue[],
): void {
  if (kind.startsWith("enum:")) {
    const allowed = ENUMS[kind.slice(5)] ?? [];
    if (typeof value !== "string" || !allowed.includes(value)) {
      issues.push({
        level: "error",
        path,
        message: `枚举值必须是以下之一：${allowed.join(" / ")}（实际：${JSON.stringify(value)}）`,
      });
    }
    return;
  }
  switch (kind) {
    case "string":
      if (typeof value !== "string")
        issues.push({ level: "error", path, message: "必须是字符串" });
      break;
    case "boolean":
      if (typeof value !== "boolean")
        issues.push({ level: "error", path, message: "必须是布尔值" });
      break;
    case "number":
    case "integer":
      if (typeof value !== "number") {
        issues.push({ level: "error", path, message: "必须是数字" });
      } else if (kind === "integer" && !Number.isInteger(value)) {
        issues.push({ level: "error", path, message: "必须是整数" });
      }
      break;
    case "valueObject":
      checkValueObject(value, path, issues);
      break;
    case "children":
      checkChildren(value, path, issues);
      break;
    case "childId":
      if (typeof value !== "string")
        issues.push({
          level: "error",
          path,
          message: "必须是子组件 id 字符串",
        });
      break;
    case "action":
      if (!isObject(value) || typeof value.name !== "string") {
        issues.push({
          level: "error",
          path,
          message: "必须是包含 name:string 的动作对象 { name, context? }",
        });
      }
      break;
    case "objectArray":
      if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
        issues.push({ level: "error", path, message: "必须是对象数组" });
      }
      break;
    case "object":
      if (!isObject(value))
        issues.push({ level: "error", path, message: "必须是对象" });
      break;
  }
}

/** 收集一行内所有组件包装节点（平铺） */
function collectWrappers(
  components: unknown[],
  basePath: string,
): Array<{ wrapper: Record<string, unknown>; path: string }> {
  const out: Array<{ wrapper: Record<string, unknown>; path: string }> = [];
  components.forEach((component, index) => {
    if (!isObject(component)) return;
    const path = `${basePath}[${index}]`;
    out.push({ wrapper: component, path });
  });
  return out;
}

/**
 * 校验完整 JSONL 协议（多轮对话为全量 + 增量逐行拼接，允许组件重复定义）。
 */
export function checkProtocol(rawProtocol: string): ComplianceReport {
  const rawLines = rawProtocol.split(/\r?\n/);
  const parsed: Array<Record<string, unknown> | null> = [];
  const lineIssues: ComplianceIssue[][] = rawLines.map(() => []);
  const lineActions: (string | null)[] = rawLines.map(() => null);

  // 第一遍：解析 + 单行结构校验
  rawLines.forEach((raw, i) => {
    const trimmed = raw.trim();
    const issues = lineIssues[i];
    if (!trimmed) {
      parsed.push(null);
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      issues.push({
        level: "error",
        path: "(json)",
        message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      });
      parsed.push(null);
      return;
    }
    if (!isObject(message)) {
      issues.push({
        level: "error",
        path: "(root)",
        message: "消息必须是 JSON 对象",
      });
      parsed.push(null);
      return;
    }
    parsed.push(message);

    const actions = ACTION_KEYS.filter((key) => key in message);
    const unknownTop = Object.keys(message).filter(
      (key) => !(ACTION_KEYS as readonly string[]).includes(key),
    );
    unknownTop.forEach((key) =>
      issues.push({
        level: "error",
        path: key,
        message: "未知顶层字段（每条消息只允许一个标准动作）",
      }),
    );
    if (actions.length === 0 && unknownTop.length === 0) {
      issues.push({
        level: "error",
        path: "(root)",
        message:
          "缺少动作：beginRendering / surfaceUpdate / dataModelUpdate / deleteSurface",
      });
    } else if (actions.length > 1) {
      issues.push({
        level: "error",
        path: "(root)",
        message: `一条消息只能包含一个动作，实际包含：${actions.join(", ")}`,
      });
    }
    const action = actions[0];
    lineActions[i] = action ?? null;

    if (action === "beginRendering")
      checkBeginRendering(message[action], issues);
    if (action === "surfaceUpdate") checkSurfaceUpdate(message[action], issues);
    if (action === "dataModelUpdate")
      checkDataModelUpdate(message[action], issues);
    if (action === "deleteSurface") checkDeleteSurface(message[action], issues);
  });

  // 第二遍：跨行文法规则 —— weight 只能出现在 Row/Column 的直接子组件上
  checkWeightUsage(parsed, lineIssues);

  const lines: LineCompliance[] = rawLines.map((raw, i) => {
    const issues = lineIssues[i];
    const hasError = issues.some((issue) => issue.level === "error");
    const hasExtension = issues.some((issue) => issue.level === "extension");
    const status: ComplianceStatus = hasError
      ? "invalid"
      : hasExtension
        ? "extension"
        : "valid";
    return {
      lineNo: i + 1,
      raw,
      action: lineActions[i],
      status,
      issues,
    };
  });

  const totals = {
    total: lines.filter((line) => line.raw.trim() !== "").length,
    valid: lines.filter((line) => line.status === "valid").length,
    extension: lines.filter((line) => line.status === "extension").length,
    invalid: lines.filter((line) => line.status === "invalid").length,
  };
  return { lines, totals };
}

function checkBeginRendering(value: unknown, issues: ComplianceIssue[]): void {
  const path = "beginRendering";
  if (!isObject(value)) {
    issues.push({ level: "error", path, message: "必须是对象" });
    return;
  }
  const unknown = Object.keys(value).filter(
    (key) => !["surfaceId", "root", "catalogId", "styles"].includes(key),
  );
  unknown.forEach((key) =>
    issues.push({
      level: "error",
      path: `${path}.${key}`,
      message: "未知字段",
    }),
  );
  if (typeof value.surfaceId !== "string") {
    issues.push({
      level: "error",
      path: `${path}.surfaceId`,
      message: "必填且为字符串",
    });
  }
  if (typeof value.root !== "string") {
    issues.push({
      level: "error",
      path: `${path}.root`,
      message: "必填且为根组件 id 字符串",
    });
  }
  if (value.catalogId !== undefined && typeof value.catalogId !== "string") {
    issues.push({
      level: "error",
      path: `${path}.catalogId`,
      message: "必须是字符串",
    });
  }
  if (value.styles !== undefined) {
    if (!isObject(value.styles)) {
      issues.push({
        level: "error",
        path: `${path}.styles`,
        message: "必须是对象",
      });
    } else {
      const styleKeys = Object.keys(value.styles);
      styleKeys
        .filter((key) => key !== "font" && key !== "primaryColor")
        .forEach((key) =>
          issues.push({
            level: "error",
            path: `${path}.styles.${key}`,
            message: "beginRendering.styles 仅允许 font / primaryColor",
          }),
        );
      const { font, primaryColor } = value.styles as Record<string, unknown>;
      if (font !== undefined && typeof font !== "string") {
        issues.push({
          level: "error",
          path: `${path}.styles.font`,
          message: "必须是字符串",
        });
      }
      if (
        primaryColor !== undefined &&
        (typeof primaryColor !== "string" ||
          !/^#[0-9a-fA-F]{6}$/.test(primaryColor))
      ) {
        issues.push({
          level: "error",
          path: `${path}.styles.primaryColor`,
          message: "必须是 #RRGGBB 六位十六进制颜色",
        });
      }
    }
  }
}

function checkSurfaceUpdate(value: unknown, issues: ComplianceIssue[]): void {
  const path = "surfaceUpdate";
  if (!isObject(value)) {
    issues.push({ level: "error", path, message: "必须是对象" });
    return;
  }
  const unknown = Object.keys(value).filter(
    (key) => key !== "surfaceId" && key !== "components",
  );
  unknown.forEach((key) =>
    issues.push({
      level: "error",
      path: `${path}.${key}`,
      message: "未知字段",
    }),
  );
  if (typeof value.surfaceId !== "string") {
    issues.push({
      level: "error",
      path: `${path}.surfaceId`,
      message: "必填且为字符串",
    });
  }
  if (!Array.isArray(value.components) || value.components.length === 0) {
    issues.push({
      level: "error",
      path: `${path}.components`,
      message: "必填且为非空数组",
    });
    return;
  }

  const wrappers = collectWrappers(value.components, `${path}.components`);
  wrappers.forEach(({ wrapper, path: wrapperPath }) => {
    const wrapperKeys = Object.keys(wrapper);
    wrapperKeys
      .filter((key) => key !== "id" && key !== "weight" && key !== "component")
      .forEach((key) =>
        issues.push({
          level: "error",
          path: `${wrapperPath}.${key}`,
          message: "组件包装节点只允许 id / weight / component",
        }),
      );
    if (typeof wrapper.id !== "string") {
      issues.push({
        level: "error",
        path: `${wrapperPath}.id`,
        message: "必填且为字符串",
      });
    }
    if (wrapper.weight !== undefined && typeof wrapper.weight !== "number") {
      issues.push({
        level: "error",
        path: `${wrapperPath}.weight`,
        message: "必须是数字",
      });
    }
    const component = wrapper.component;
    if (component === undefined) {
      issues.push({
        level: "error",
        path: `${wrapperPath}.component`,
        message: "必填",
      });
      return;
    }
    if (!isObject(component)) {
      issues.push({
        level: "error",
        path: `${wrapperPath}.component`,
        message: "必须是对象",
      });
      return;
    }
    const typeNames = Object.keys(component);
    if (typeNames.length !== 1) {
      issues.push({
        level: "error",
        path: `${wrapperPath}.component`,
        message: `必须且只能包含一个组件类型键，实际：${typeNames.join(", ") || "(空)"}`,
      });
      return;
    }
    const typeName = typeNames[0];
    const spec = COMPONENT_SPECS[typeName];
    if (!spec) {
      issues.push({
        level: "error",
        path: `${wrapperPath}.component.${typeName}`,
        message: `未知组件类型「${typeName}」，不在 v0.8 标准目录中`,
      });
      return;
    }
    const props = component[typeName];
    if (!isObject(props)) {
      issues.push({
        level: "error",
        path: `${wrapperPath}.component.${typeName}`,
        message: "组件属性必须是对象",
      });
      return;
    }
    const propsPath = `${wrapperPath}.component.${typeName}`;
    spec.required.forEach((key) => {
      if (!(key in props)) {
        issues.push({
          level: "error",
          path: `${propsPath}.${key}`,
          message: `缺少必填属性 ${key}`,
        });
      }
    });
    Object.entries(props).forEach(([key, value]) => {
      if (key === "styles") {
        // 项目方言扩展：组件级 styles（标准仅允许在 beginRendering 上）
        issues.push({
          level: "extension",
          path: `${propsPath}.styles`,
          message: "组件级 styles 为项目扩展，v0.8 标准不支持",
        });
        return;
      }
      const kind = spec.props[key];
      if (!kind) {
        issues.push({
          level: "error",
          path: `${propsPath}.${key}`,
          message: `${typeName} 的未知属性「${key}」（additionalProperties: false）`,
        });
        return;
      }
      checkProp(kind, value, `${propsPath}.${key}`, issues);
    });
  });
}

function checkDataModelUpdate(value: unknown, issues: ComplianceIssue[]): void {
  const path = "dataModelUpdate";
  if (!isObject(value)) {
    issues.push({ level: "error", path, message: "必须是对象" });
    return;
  }
  const unknown = Object.keys(value).filter(
    (key) => !["surfaceId", "path", "contents"].includes(key),
  );
  unknown.forEach((key) =>
    issues.push({
      level: "error",
      path: `${path}.${key}`,
      message: "未知字段",
    }),
  );
  if (typeof value.surfaceId !== "string") {
    issues.push({
      level: "error",
      path: `${path}.surfaceId`,
      message: "必填且为字符串",
    });
  }
  if (value.path !== undefined && typeof value.path !== "string") {
    issues.push({
      level: "error",
      path: `${path}.path`,
      message: "必须是字符串路径",
    });
  }
  if (!Array.isArray(value.contents)) {
    issues.push({
      level: "error",
      path: `${path}.contents`,
      message: "必填且为数组",
    });
    return;
  }
  checkDataEntries(value.contents, `${path}.contents`, issues);
}

/**
 * 校验 dataModelUpdate 数据条目（邻接表）。
 * 每条：key:string + 恰好一个 value*；valueMap 为同构条目数组，可递归嵌套。
 */
function checkDataEntries(
  entries: unknown[],
  path: string,
  issues: ComplianceIssue[],
): void {
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isObject(entry)) {
      issues.push({ level: "error", path: entryPath, message: "必须是对象" });
      return;
    }
    const unknownKeys = Object.keys(entry).filter(
      (key) =>
        ![
          "key",
          "valueString",
          "valueNumber",
          "valueBoolean",
          "valueMap",
        ].includes(key),
    );
    unknownKeys.forEach((key) =>
      issues.push({
        level: "error",
        path: `${entryPath}.${key}`,
        message: "未知字段",
      }),
    );
    if (typeof entry.key !== "string") {
      issues.push({
        level: "error",
        path: `${entryPath}.key`,
        message: "必填且为字符串",
      });
    }
    const valueKeys = [
      "valueString",
      "valueNumber",
      "valueBoolean",
      "valueMap",
    ].filter((key) => key in entry);
    if (valueKeys.length === 0) {
      issues.push({
        level: "error",
        path: entryPath,
        message:
          "必须包含一个 valueString / valueNumber / valueBoolean / valueMap",
      });
    } else if (valueKeys.length > 1) {
      issues.push({
        level: "error",
        path: entryPath,
        message: `只能包含一个 value* 字段，实际：${valueKeys.join(", ")}`,
      });
    } else {
      const key = valueKeys[0];
      const v = entry[key];
      const typeOk =
        (key === "valueString" && typeof v === "string") ||
        (key === "valueNumber" && typeof v === "number") ||
        (key === "valueBoolean" && typeof v === "boolean") ||
        (key === "valueMap" && Array.isArray(v));
      if (!typeOk) {
        issues.push({
          level: "error",
          path: `${entryPath}.${key}`,
          message:
            key === "valueMap"
              ? "valueMap 必须是邻接表数组"
              : "值类型与字段不匹配",
        });
      } else if (key === "valueMap") {
        checkDataEntries(v as unknown[], `${entryPath}.valueMap`, issues);
      }
    }
  });
}

function checkDeleteSurface(value: unknown, issues: ComplianceIssue[]): void {
  if (!isObject(value) || typeof value.surfaceId !== "string") {
    issues.push({
      level: "error",
      path: "deleteSurface.surfaceId",
      message: "必填且为字符串",
    });
  }
  if (isObject(value)) {
    Object.keys(value)
      .filter((key) => key !== "surfaceId")
      .forEach((key) =>
        issues.push({
          level: "error",
          path: `deleteSurface.${key}`,
          message: "未知字段",
        }),
      );
  }
}

/**
 * 跨行文法：weight 只能出现在 Row / Column 的直接子组件上。
 * 协议为流式增量，引用可能跨消息，因此基于全部 surfaceUpdate 累积判断。
 */
function checkWeightUsage(
  parsed: Array<Record<string, unknown> | null>,
  lineIssues: ComplianceIssue[][],
): void {
  /** 所有被 Row/Column 的 children.explicitList 引用过的组件 id */
  const rowColumnChildren = new Set<string>();
  parsed.forEach((message) => {
    if (!message?.surfaceUpdate) return;
    const update = message.surfaceUpdate;
    if (!isObject(update) || !Array.isArray(update.components)) return;
    for (const component of update.components) {
      if (!isObject(component) || !isObject(component.component)) continue;
      for (const [typeName, props] of Object.entries(component.component)) {
        if ((typeName !== "Row" && typeName !== "Column") || !isObject(props))
          continue;
        const children = props.children;
        if (isObject(children) && Array.isArray(children.explicitList)) {
          children.explicitList.forEach((id) => {
            if (typeof id === "string") rowColumnChildren.add(id);
          });
        }
      }
    }
  });

  parsed.forEach((message, lineIndex) => {
    if (!message?.surfaceUpdate) return;
    const update = message.surfaceUpdate;
    if (!isObject(update) || !Array.isArray(update.components)) return;
    update.components.forEach((component, index) => {
      if (!isObject(component)) return;
      if (
        "weight" in component &&
        typeof component.id === "string" &&
        !rowColumnChildren.has(component.id)
      ) {
        lineIssues[lineIndex].push({
          level: "error",
          path: `surfaceUpdate.components[${index}].weight`,
          message: "weight 只能设置在 Row / Column 的直接子组件上",
        });
      }
    });
  });
}
