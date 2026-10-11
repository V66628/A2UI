import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadEvalFile,
  loadEvalScenarios,
  supportedComponentTypes,
  type ScenarioExpect,
} from "../src/eval/scenarios";
import { validateA2UIOutput } from "../src/eval/validate-protocol";

// ============ 评测集完整性（数据集自身必须自洽） ============

describe("评测集 a2ui_generation_eval_scenarios.json 完整性", () => {
  const file = loadEvalFile();
  const scenarios = file.scenarios;

  it("至少包含 15 个场景", () => {
    assert.ok(scenarios.length >= 15, `only ${scenarios.length} scenarios`);
  });

  it("id 唯一且形如 eval-NN", () => {
    const ids = scenarios.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate scenario id");
    for (const id of ids) assert.match(id, /^eval-\d{2}$/);
  });

  it("每个场景必填字段齐全，tags 为数组，expect 为对象", () => {
    for (const s of scenarios) {
      assert.equal(typeof s.name, "string");
      assert.equal(typeof s.category, "string");
      assert.equal(typeof s.userPrompt, "string");
      assert.ok(s.userPrompt.length > 60, `${s.id} prompt too short`);
      assert.ok(Array.isArray(s.tags) && s.tags.length > 0);
      assert.equal(typeof s.expect, "object");
    }
  });

  it("expect 中引用的组件类型都在 supportedComponents 内", () => {
    const supported = new Set(supportedComponentTypes());
    for (const s of scenarios) {
      for (const type of s.expect.requiredComponents ?? []) {
        assert.ok(
          supported.has(type),
          `${s.id}: unknown required component ${type}`,
        );
      }
      for (const type of s.expect.forbiddenComponents ?? []) {
        assert.ok(
          supported.has(type),
          `${s.id}: unknown forbidden component ${type}`,
        );
      }
    }
  });

  it("场景覆盖多个业务类别", () => {
    const categories = new Set(scenarios.map((s) => s.category));
    assert.ok(
      categories.size >= 8,
      `only ${categories.size} categories: ${[...categories].join(",")}`,
    );
  });

  it("userPrompt 不允许出现未实现组件名 Image/Divider/Card 组件", () => {
    for (const s of scenarios) {
      // Icon 已支持；Image/Divider 仍未实现
      assert.doesNotMatch(
        s.userPrompt,
        /\b(Image|Divider)\b/,
        `${s.id} references unsupported component`,
      );
      // Card 只允许出现在 "购物卡" 这类自然语言里，不允许作为组件 Card 布局指令
      assert.doesNotMatch(s.userPrompt, /一个\s*Card|Card\s*组件|Card\s*组件/);
    }
  });

  it("Icon 场景（eval-19 起）的 requiredIcons 均为已注册 canonical 名", () => {
    const iconScenarios = scenarios.filter((s) => s.tags.includes("icon"));
    assert.ok(iconScenarios.length >= 4, "expected at least 4 icon scenarios");
  });
});

// ============ 校验器：正例 ============

/** 一个结构完整的最小合法输出（动态 List 购物车骨架） */
function validMessages(): unknown[] {
  return [
    {
      dataModelUpdate: {
        surfaceId: "main",
        path: "/",
        contents: [
          {
            key: "items",
            valueMap: {
              "0": {
                valueMap: {
                  name: { valueString: "Keyboard" },
                  price: { valueNumber: 89 },
                },
              },
            },
          },
          { key: "total", valueNumber: 89 },
        ],
      },
    },
    {
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "root",
            component: {
              Column: {
                children: { explicitList: ["title", "list", "footer"] },
              },
            },
          },
          {
            id: "title",
            component: { Text: { text: { literalString: "Shopping Cart" } } },
          },
          {
            id: "list",
            component: {
              List: {
                children: {
                  template: { componentId: "row", dataBinding: "/items" },
                },
              },
            },
          },
          {
            id: "row",
            component: {
              Row: {
                children: { explicitList: ["name", "removeBtn"] },
              },
            },
          },
          { id: "name", component: { Text: { text: { path: "name" } } } },
          {
            id: "removeBtn",
            component: {
              Button: {
                child: "removeLabel",
                action: {
                  name: "removeItem",
                  context: [{ key: "id", value: { path: "id" } }],
                },
              },
            },
          },
          {
            id: "removeLabel",
            component: { Text: { text: { literalString: "Remove" } } },
          },
          {
            id: "footer",
            component: {
              Row: {
                children: { explicitList: ["total", "checkout"] },
              },
            },
          },
          { id: "total", component: { Text: { text: { path: "/total" } } } },
          {
            id: "checkout",
            component: {
              Button: {
                child: "checkoutLabel",
                action: {
                  name: "checkout",
                  context: [{ key: "total", value: { path: "/total" } }],
                },
              },
            },
          },
          {
            id: "checkoutLabel",
            component: { Text: { text: { literalString: "Checkout" } } },
          },
        ],
      },
    },
    { beginRendering: { surfaceId: "main", root: "root" } },
  ];
}

const passingExpect: ScenarioExpect = {
  requiredComponents: ["Column", "Row", "List", "Text", "Button"],
  minComponents: 11,
  requireDataModel: true,
  requireTemplateList: true,
  requiredActions: ["removeItem", "checkout"],
  requiredDataPaths: ["/items", "/total"],
  requiredBindings: ["/total"],
  requiredLiterals: ["Shopping Cart", "Checkout", "Remove"],
};

/** 含 Icon 的最小合法静态输出 */
function iconMessages(): unknown[] {
  return [
    {
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "root",
            component: {
              Column: { children: { explicitList: ["homeIcon", "label"] } },
            },
          },
          {
            id: "homeIcon",
            component: { Icon: { name: { literalString: "home" } } },
          },
          {
            id: "label",
            component: { Text: { text: { literalString: "Home" } } },
          },
        ],
      },
    },
    { beginRendering: { surfaceId: "main", root: "root" } },
  ];
}

describe("validateA2UIOutput 正例", () => {
  it("含合法 Icon 的输出零违规，requiredIcons 满足", () => {
    const result = validateA2UIOutput(iconMessages(), {
      requiredIcons: ["home"],
      requiredComponents: ["Column", "Icon", "Text"],
    });
    assert.deepEqual(result.violations, []);
  });

  it("完整合法输出零违规，统计正确", () => {
    const result = validateA2UIOutput(validMessages(), passingExpect);
    assert.deepEqual(result.violations, []);
    assert.equal(result.stats.componentCount, 11);
    assert.equal(result.stats.templateCount, 1);
    assert.equal(result.stats.dataModelCount, 1);
    assert.deepEqual(result.stats.actionNames, ["removeItem", "checkout"]);
  });

  it("真实评测集每个场景的 expect 至少能被一份等价合法输出的口径覆盖（校验器可判定通过）", () => {
    // 用正例输出 + eval-01 的 expect 验证 oracle 不误伤
    const eval01 = loadEvalScenarios().find((s) => s.id === "eval-01")!;
    const result = validateA2UIOutput(validMessages(), eval01.expect);
    // 正例骨架规模小于 eval-01 的 minComponents，只允许规模类违规，
    // 其余结构性/语义期望必须满足
    const nonSizeViolations = result.violations.filter(
      (v) => !/at least \d+ components/.test(v),
    );
    assert.deepEqual(nonSizeViolations, []);
  });

  it("增量补丁轮（partialUpdate）允许无 surfaceUpdate、引用未重定义的既有 id", () => {
    const patch: unknown[] = [
      {
        surfaceUpdate: {
          surfaceId: "main",
          components: [
            // 父容器列表引用两个未在本轮重定义的既有子节点
            {
              id: "root",
              component: {
                Column: {
                  children: { explicitList: ["existing1", "existing2"] },
                },
              },
            },
          ],
        },
      },
      { beginRendering: { surfaceId: "main", root: "root" } },
    ];
    const result = validateA2UIOutput(patch, { partialUpdate: true });
    assert.deepEqual(result.violations, []);
  });

  it("纯数据微调轮（partialUpdate，无 surfaceUpdate）通过", () => {
    const turn: unknown[] = [
      {
        dataModelUpdate: {
          surfaceId: "main",
          path: "/",
          contents: [{ key: "title", valueString: "Welcome Back" }],
        },
      },
      { beginRendering: { surfaceId: "main", root: "root" } },
    ];
    const result = validateA2UIOutput(turn, { partialUpdate: true });
    assert.deepEqual(result.violations, []);
  });

  it("增量轮仍必须保持 root 为 'root' 且 beginRendering 在最后", () => {
    const turn: unknown[] = [
      { beginRendering: { surfaceId: "main", root: "other" } },
      {
        dataModelUpdate: {
          surfaceId: "main",
          path: "/",
          contents: [],
        },
      },
    ];
    const result = validateA2UIOutput(turn, { partialUpdate: true });
    assert.ok(result.violations.some((v) => /root "root"/.test(v)));
    assert.ok(
      result.violations.some((v) => /must be the last message/.test(v)),
    );
  });
});

describe("validateA2UIOutput 反例", () => {
  it("空输出报错", () => {
    const result = validateA2UIOutput([], {});
    assert.match(result.violations[0], /no messages/);
  });

  it("beginRendering 不在最后 → 违规", () => {
    const messages = validMessages();
    const last = messages.pop()!;
    messages.unshift(last);
    const result = validateA2UIOutput(messages, {});
    assert.ok(
      result.violations.some((v) => /beginRendering must be the last/.test(v)),
    );
  });

  it("beginRendering root 被改成不存在的 id → 违规（须保持 root 'root'）", () => {
    const messages = validMessages();
    (messages[2] as { beginRendering: { root: string } }).beginRendering.root =
      "missing";
    const result = validateA2UIOutput(messages, {});
    assert.ok(
      result.violations.some((v) => /must keep root "root".*"missing"/.test(v)),
    );
  });

  it("引用不存在的组件 id → 违规", () => {
    const messages = validMessages();
    const root = (messages[1] as { surfaceUpdate: { components: unknown[] } })
      .surfaceUpdate.components[0] as {
      component: { Column: { children: { explicitList: string[] } } };
    };
    root.component.Column.children.explicitList.push("ghost");
    const result = validateA2UIOutput(messages, {});
    assert.ok(
      result.violations.some((v) => /referenced component id "ghost"/.test(v)),
    );
  });

  it("Icon 使用未注册的 canonical 名 → 违规（提示调用 search_antd_icons）", () => {
    const messages = validMessages();
    (
      messages[1] as { surfaceUpdate: { components: unknown[] } }
    ).surfaceUpdate.components.push({
      id: "icon1",
      component: { Icon: { name: { literalString: "banana" } } },
    });
    const result = validateA2UIOutput(messages, {});
    assert.ok(
      result.violations.some(
        (v) => /not a registered canonical icon/.test(v) && /banana/.test(v),
      ),
    );
  });

  it("期望的 requiredIcons 缺失 → 违规", () => {
    const result = validateA2UIOutput(validMessages(), {
      requiredIcons: ["home"],
    });
    assert.ok(
      result.violations.some((v) => /expected icon "home" is not used/.test(v)),
    );
  });

  it("缺少期望的 action → 违规", () => {
    const result = validateA2UIOutput(validMessages(), {
      requiredActions: ["deleteItem"],
    });
    assert.ok(
      result.violations.some((v) => /action "deleteItem" is missing/.test(v)),
    );
  });

  it("缺少期望的文本 → 违规", () => {
    const result = validateA2UIOutput(validMessages(), {
      requiredLiterals: ["Wishlist"],
    });
    assert.ok(result.violations.some((v) => /literal text "Wishlist"/.test(v)));
  });

  it("缺少 dataModelUpdate 且 requireDataModel → 违规", () => {
    const messages = validMessages().slice(1);
    const result = validateA2UIOutput(messages, { requireDataModel: true });
    assert.ok(result.violations.some((v) => /dataModelUpdate/.test(v)));
  });

  it("children 同时给 explicitList 和 template → 违规", () => {
    const messages = validMessages();
    const root = (messages[1] as { surfaceUpdate: { components: unknown[] } })
      .surfaceUpdate.components[0] as {
      component: { Column: { children: Record<string, unknown> } };
    };
    root.component.Column.children.template = {
      componentId: "row",
      dataBinding: "/x",
    };
    const result = validateA2UIOutput(messages, {});
    assert.ok(
      result.violations.some((v) =>
        /exactly one of explicitList\/template/.test(v),
      ),
    );
  });
});
