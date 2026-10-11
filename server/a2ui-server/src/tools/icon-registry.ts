import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 单条图标注册项 */
export interface IconRegistryEntry {
  /** 协议 Icon.name 使用的 canonical 名 */
  name: string;
  /** 对应的 antd 组件名（@ant-design/icons 导出名） */
  antdIcon: string;
  /** 搜索关键词（英文/中文，小写） */
  keywords: string[];
}

interface IconRegistryFile {
  description: string;
  icons: IconRegistryEntry[];
}

const REGISTRY_FILE_NAME = "antd-icons.json";

let cached: IconRegistryFile | null = null;

function resolveRegistryPath(): string {
  const candidates = [
    resolve(__dirname, REGISTRY_FILE_NAME),
    resolve(process.cwd(), "src", "tools", REGISTRY_FILE_NAME),
    resolve(process.cwd(), REGISTRY_FILE_NAME),
  ];
  const path = candidates.find((item) => existsSync(item));
  if (!path) {
    throw new Error(`Icon registry file not found: ${REGISTRY_FILE_NAME}`);
  }
  return path;
}

/** 加载并缓存图标注册表 */
export function loadIconRegistry(): IconRegistryFile {
  if (cached) return cached;
  cached = JSON.parse(
    readFileSync(resolveRegistryPath(), "utf8"),
  ) as IconRegistryFile;
  return cached;
}

/** 全部图标注册项 */
export function allIconEntries(): IconRegistryEntry[] {
  return loadIconRegistry().icons;
}

/** canonical 名是否已注册 */
export function isCanonicalIconName(name: string): boolean {
  return allIconEntries().some((entry) => entry.name === name);
}

/** 查询结果条目（带命中的匹配类型，便于调试） */
export interface IconSearchMatch extends IconRegistryEntry {
  score: number;
}

/** 归一化查询串：小写、去多余空白 */
function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 对单个候选打分：名称/关键词命中，越靠前越精确 */
function scoreEntry(entry: IconRegistryEntry, query: string): number {
  let score = 0;
  for (const keyword of entry.keywords) {
    if (keyword === query) {
      score = Math.max(score, 100);
    } else if (keyword.startsWith(query)) {
      score = Math.max(score, 60);
    } else if (keyword.includes(query)) {
      score = Math.max(score, 40);
    } else if (query.includes(keyword)) {
      score = Math.max(score, 30);
    }
  }
  if (entry.name === query) score = Math.max(score, 100);
  else if (entry.name.startsWith(query)) score = Math.max(score, 70);
  else if (entry.name.includes(query)) score = Math.max(score, 50);
  return score;
}

/**
 * 按自然语言关键词搜索可用图标（多词时所有词都需命中），
 * 按相关度降序返回，默认 8 条。
 */
export function searchIcons(
  rawQuery: string,
  limit = 8,
): IconSearchMatch[] {
  const query = normalizeQuery(rawQuery);
  if (!query) return [];

  // 支持多词 AND：拆成 token，每个 token 分别取分
  const tokens = query.split(/\s+/).filter(Boolean);

  const matches: IconSearchMatch[] = [];
  for (const entry of allIconEntries()) {
    let total = 0;
    for (const token of tokens) {
      const s = scoreEntry(entry, token);
      if (s === 0) {
        total = 0;
        break;
      }
      total += s;
    }
    if (total > 0) matches.push({ ...entry, score: total });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}
