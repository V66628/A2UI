import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allIconEntries,
  isCanonicalIconName,
  searchIcons,
} from "../src/tools/icon-registry";
import { searchIconsTool } from "../src/tools/search-icons-tool";
import { toOpenAITool } from "../src/tools/agent-tool";

describe("图标注册表", () => {
  it("加载全部 48 个标准图标，canonical 名唯一", () => {
    const icons = allIconEntries();
    assert.equal(icons.length, 48);
    assert.equal(new Set(icons.map((i) => i.name)).size, 48);
    // 每条都映射到非空 antd 组件名与关键词
    for (const entry of icons) {
      assert.ok(
        /Outlined$|Filled$/.test(entry.antdIcon),
        `${entry.name} bad antd mapping`,
      );
      assert.ok(entry.keywords.length >= 3, `${entry.name} needs keywords`);
    }
  });

  it("isCanonicalIconName 判定", () => {
    assert.equal(isCanonicalIconName("home"), true);
    assert.equal(isCanonicalIconName("settings"), true);
    assert.equal(isCanonicalIconName("nope"), false);
  });

  it("英文关键词搜索：home 首条为 home", () => {
    const matches = searchIcons("home");
    assert.ok(matches.length > 0);
    assert.equal(matches[0].name, "home");
  });

  it("中文关键词搜索：购物车 / 设置", () => {
    assert.equal(searchIcons("购物车")[0].name, "shoppingCart");
    assert.equal(searchIcons("设置")[0].name, "settings");
  });

  it("多词 AND 搜索（shopping cart）与 limit 生效", () => {
    const matches = searchIcons("shopping cart", 3);
    assert.ok(matches.length <= 3);
    assert.equal(matches[0].name, "shoppingCart");
  });

  it("空查询返回空数组", () => {
    assert.deepEqual(searchIcons("   "), []);
  });

  it("无命中返回空数组", () => {
    assert.deepEqual(searchIcons("zzzzqqq"), []);
  });
});

describe("search_antd_icons 工具", () => {
  it("工具描述可转 OpenAI function 定义", () => {
    const def = toOpenAITool(searchIconsTool);
    assert.equal(def.type, "function");
    assert.equal(def.function.name, "search_antd_icons");
    assert.deepEqual(def.function.parameters.required, ["query"]);
  });

  it("execute 返回候选图标并带 canonical 名/antd 名/使用说明", async () => {
    const raw = await searchIconsTool.execute({ query: "home", limit: 5 });
    const parsed = JSON.parse(raw) as {
      count: number;
      note: string;
      icons: Array<{ name: string; antdIcon: string }>;
    };
    assert.ok(parsed.count > 0);
    assert.equal(parsed.icons[0].name, "home");
    assert.equal(parsed.icons[0].antdIcon, "HomeOutlined");
    assert.match(parsed.note, /canonical/);
  });

  it("execute 缺少 query → 返回错误结构", async () => {
    const parsed = JSON.parse(await searchIconsTool.execute({})) as {
      error?: string;
    };
    assert.equal(parsed.error, "query is required");
  });

  it("execute 中文 query（通知铃铛）→ 返回 notifications", async () => {
    const parsed = JSON.parse(
      await searchIconsTool.execute({ query: "通知铃铛" }),
    ) as { icons: Array<{ name: string }> };
    assert.ok(parsed.icons.some((i) => i.name === "notifications"));
  });
});
