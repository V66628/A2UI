/**
 * A2UI Agent prompt 组装：
 *
 *   prompt 模板（specification/docs/a2ui_agent_prompt.md）
 *     + Renderer Catalog（specification/json/catalogs/renderer/renderer_catalog.json）
 *   → 完整 system prompt。
 *
 * 协议知识（模板与 catalog）按 A2UI 规范在服务端编译期内置、运行时从仓库文件
 * 读取，不通过网络下载，避免外部内容注入 prompt。读取结果进程内缓存。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PROMPT_TEMPLATE_RELATIVE = join(
  "specification",
  "docs",
  "a2ui_agent_prompt.md",
);
const RENDERER_CATALOG_RELATIVE = join(
  "specification",
  "json",
  "catalogs",
  "renderer",
  "renderer_catalog.json",
);

/**
 * 仓库根候选路径：
 *   - 由本文件位置上溯（src/agent → src → a2ui-server → server → 仓库根），
 *     ts-node 与 tsc 产物（dist/agent，层级相同）均适用；
 *   - 由 cwd 上溯（pnpm dev/test 时 cwd 为 server/a2ui-server）；
 *   - cwd 本身（若以仓库根启动）。
 */
function repoRootCandidates(): string[] {
  return [
    resolve(__dirname, "..", "..", "..", ".."),
    resolve(process.cwd(), "..", ".."),
    process.cwd(),
  ];
}

function readRepoFile(relative: string): string {
  const tried: string[] = [];
  for (const root of repoRootCandidates()) {
    const full = resolve(root, relative);
    tried.push(full);
    if (existsSync(full)) return readFileSync(full, "utf8");
  }
  throw new Error(
    `Cannot locate ${relative} from any candidate root:\n  ${tried.join("\n  ")}`,
  );
}

let templateCache: string | undefined;
let catalogCache: unknown | undefined;

/** 读取 prompt 模板原文（缓存） */
export function loadPromptTemplate(): string {
  if (templateCache === undefined) {
    templateCache = readRepoFile(PROMPT_TEMPLATE_RELATIVE);
  }
  return templateCache;
}

/** 读取 Renderer Catalog 定义对象（缓存） */
export function loadRendererCatalog(): unknown {
  if (catalogCache === undefined) {
    const raw = readRepoFile(RENDERER_CATALOG_RELATIVE);
    catalogCache = JSON.parse(raw) as unknown;
  }
  return catalogCache;
}

/**
 * 组装完整 system prompt：将模板中的 {{RENDERER_CATALOG}} 替换为
 * 紧凑 JSON catalog。替换后模板不应残留任何 {{...}} 占位符。
 */
export function buildSystemPrompt(): string {
  const template = loadPromptTemplate();
  const catalogJson = JSON.stringify(loadRendererCatalog(), null, 2);
  const assembled = template.replace(/\{\{RENDERER_CATALOG\}\}/g, catalogJson);

  const leftover = /\{\{[^}]+\}\}/.exec(assembled);
  if (leftover) {
    throw new Error(
      `Unresolved prompt placeholder in assembled system prompt: ${leftover[0]}`,
    );
  }
  return assembled;
}
