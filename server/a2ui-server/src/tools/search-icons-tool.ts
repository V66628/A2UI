import type { AgentTool } from "./agent-tool";
import { searchIcons } from "./icon-registry";

/**
 * search_antd_icons 工具：
 * 模型在界面中需要使用图标时，用自然语言关键词（如 "shopping cart"、
 * "设置"、"删除"）查询本工具，返回按相关度排序的候选图标。
 *
 * 关键约束在返回结果中明示：Icon.name 只能使用返回的 canonical `name`
 * （协议合法值），`antdIcon` 仅供了解底层实现，禁止把 antd 组件名
 * 写进协议，也禁止编造未返回的图标名。
 */
export const searchIconsTool: AgentTool = {
  name: "search_antd_icons",
  description:
    "Search available A2UI icons (rendered via the antd / @ant-design/icons library) by a natural-language keyword. " +
    "Call this BEFORE emitting an Icon component whenever you are unsure which icon names are valid. " +
    "Supports English or Chinese keywords (e.g. 'home', 'user', '设置', '购物车'). " +
    "Returns canonical icon names that you MUST put in Icon.name, plus the underlying antd component name.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Keywords describing the icon wanted, e.g. 'shopping cart', 'lock', 'notification bell'.",
      },
      limit: {
        type: "number",
        description: "Maximum number of candidates to return (default 8).",
      },
    },
    required: ["query"],
  },

  async execute(args) {
    const query = typeof args.query === "string" ? args.query : "";
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(20, Math.trunc(args.limit)))
        : 8;

    if (!query.trim()) {
      return JSON.stringify({
        error: "query is required",
        icons: [],
      });
    }

    const matches = searchIcons(query, limit).map((entry) => ({
      name: entry.name,
      antdIcon: entry.antdIcon,
      score: entry.score,
    }));

    return JSON.stringify(
      {
        query,
        note:
          "Use the canonical `name` value as Icon.name. Do not use `antdIcon` in the protocol and do not invent icon names absent from this list.",
        count: matches.length,
        icons: matches,
      },
      null,
      2,
    );
  },
};
