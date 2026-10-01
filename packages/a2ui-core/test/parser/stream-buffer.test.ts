import assert from "node:assert";
import { createParser } from "../../src/parser/index.js";
import {
  createJsonStreamBuffer,
  extractCompleteJson,
  normalizeMessageFrames,
} from "../../src/parser/stream-buffer.js";

describe("JSON stream 缓冲区", () => {
  describe("extractCompleteJson - 大括号配平成帧", () => {
    it("完整单对象直接成帧，无滞留", () => {
      const result = extractCompleteJson('{"a":1}');
      assert.deepStrictEqual(result.frames, ['{"a":1}']);
      assert.strictEqual(result.rest, "");
    });

    it("不完整分片全部滞留 rest，不产生帧", () => {
      const result = extractCompleteJson('{"a":');
      assert.deepStrictEqual(result.frames, []);
      assert.strictEqual(result.rest, '{"a":');
    });

    it("一个分片含多条消息（换行分隔）时全部提取", () => {
      const result = extractCompleteJson('{"a":1}\n{"b":2}');
      assert.deepStrictEqual(result.frames, ['{"a":1}', '{"b":2}']);
      assert.strictEqual(result.rest, "");
    });

    it("一个分片含多条消息（无换行粘连）时同样全部提取", () => {
      const result = extractCompleteJson('{"a":1}{"b":2}');
      assert.deepStrictEqual(result.frames, ['{"a":1}', '{"b":2}']);
      assert.strictEqual(result.rest, "");
    });

    it("一帧完整 + 尾部不完整：帧提取、尾部滞留", () => {
      const result = extractCompleteJson('{"a":1}{"b":');
      assert.deepStrictEqual(result.frames, ['{"a":1}']);
      assert.strictEqual(result.rest, '{"b":');
    });

    it("帧前空白与换行跳过，不进入 rest", () => {
      const result = extractCompleteJson('  \n\t {"a":1}');
      assert.deepStrictEqual(result.frames, ['{"a":1}']);
      assert.strictEqual(result.rest, "");
    });

    it("嵌套对象按最外层深度成帧", () => {
      const raw = '{"surfaceUpdate":{"components":[{"id":"x"}]}}';
      const result = extractCompleteJson(raw);
      assert.deepStrictEqual(result.frames, [raw]);
      assert.strictEqual(result.rest, "");
    });

    it("字符串内括号不计数", () => {
      const raw = '{"text":"a } b { c"}';
      const result = extractCompleteJson(raw);
      assert.deepStrictEqual(result.frames, [raw]);
      assert.strictEqual(result.rest, "");
    });

    it("字符串内转义引号与转义反斜杠正确穿透", () => {
      const raw = '{"a":"x\\"}b\\\\c"}';
      const result = extractCompleteJson(raw);
      assert.deepStrictEqual(result.frames, [raw]);
      assert.strictEqual(result.rest, "");
    });

    it("逐字符分片累积最终恰好成一帧（模拟任意位置切分）", () => {
      const raw = '{"a":{"b":[1,2]},"c":"d}e"}';
      let pending = "";
      const collected: string[] = [];
      for (const ch of raw) {
        const result = extractCompleteJson(pending + ch);
        pending = result.rest;
        collected.push(...result.frames);
      }
      assert.deepStrictEqual(collected, [raw]);
      assert.strictEqual(pending, "");
    });

    it("空字符串：无帧、无滞留", () => {
      const result = extractCompleteJson("");
      assert.deepStrictEqual(result.frames, []);
      assert.strictEqual(result.rest, "");
    });

    it("纯空白输入（空格/换行/制表符）：无帧、无滞留", () => {
      const result = extractCompleteJson("   \r\n\t  ");
      assert.deepStrictEqual(result.frames, []);
      assert.strictEqual(result.rest, "");
    });

    it("空对象 {} 正常成帧", () => {
      const result = extractCompleteJson("{}");
      assert.deepStrictEqual(result.frames, ["{}"]);
      assert.strictEqual(result.rest, "");
    });

    it("对象之外的杂散右括号忽略，不产生错误或滞留", () => {
      assert.deepStrictEqual(extractCompleteJson("}").frames, []);
      const result = extractCompleteJson('}{"a":1}');
      assert.deepStrictEqual(result.frames, ['{"a":1}']);
      assert.strictEqual(result.rest, "");
    });

    it("数组括号不参与配平：顶层数组内的对象仍按对象边界成帧", () => {
      const result = extractCompleteJson('[{"a":1}]');
      assert.deepStrictEqual(result.frames, ['{"a":1}']);
      assert.strictEqual(result.rest, "");
    });

    it("分片恰好在字符串中间切断：滞留后续拼仍能成帧", () => {
      const first = extractCompleteJson('{"a":"hel');
      assert.deepStrictEqual(first.frames, []);
      assert.strictEqual(first.rest, '{"a":"hel');

      const second = extractCompleteJson(first.rest + 'lo"}');
      assert.deepStrictEqual(second.frames, ['{"a":"hello"}']);
      assert.strictEqual(second.rest, "");
    });

    it("分片恰好切在转义反斜杠之后：rest 重扫状态重建，转义不串行", () => {
      // 首段结尾是字符串中一个反斜杠字符
      const first = extractCompleteJson('{"a":"x\\');
      assert.deepStrictEqual(first.frames, []);
      const second = extractCompleteJson(first.rest + '"y"}');
      assert.deepStrictEqual(second.frames, ['{"a":"x\\"y"}']);
      assert.strictEqual(second.rest, "");
      // 转义引号正确，值为 x"y
      assert.strictEqual(JSON.parse(second.frames[0]).a, 'x"y');
    });

    it("完整帧之后的尾部空白与换行不进入 rest", () => {
      const result = extractCompleteJson('{"a":1}  \r\n\t ');
      assert.deepStrictEqual(result.frames, ['{"a":1}']);
      assert.strictEqual(result.rest, "");
    });

    it("字符串含中文字符不影响成帧", () => {
      const raw = '{"a":"中文内容"}';
      const result = extractCompleteJson(raw);
      assert.deepStrictEqual(result.frames, [raw]);
      assert.strictEqual(result.rest, "");
    });

    it("两帧完整 + 第三帧滞留：续拼后第三帧独立成帧且内容正确", () => {
      const first = extractCompleteJson('{"a":1}{"b":2}{"c":');
      assert.deepStrictEqual(first.frames, ['{"a":1}', '{"b":2}']);
      assert.strictEqual(first.rest, '{"c":');

      const second = extractCompleteJson(first.rest + "3}");
      assert.deepStrictEqual(second.frames, ['{"c":3}']);
      assert.strictEqual(second.rest, "");
    });
  });

  describe("normalizeMessageFrames - surfaceUpdate 拆分", () => {
    const multiLine = JSON.stringify({
      surfaceUpdate: {
        surfaceId: "s1",
        components: [
          { id: "a", component: { Text: {} } },
          { id: "b", component: { Text: {} } },
          { id: "c", component: { Text: {} } },
        ],
      },
    });

    it("多 component 拆为独立 JSONL，顺序与 surfaceId 保留", () => {
      const lines = normalizeMessageFrames(multiLine);
      assert.strictEqual(lines.length, 3);
      lines.forEach((line, index) => {
        const message = JSON.parse(line);
        assert.strictEqual(message.surfaceUpdate.surfaceId, "s1");
        assert.strictEqual(message.surfaceUpdate.components.length, 1);
        assert.strictEqual(
          message.surfaceUpdate.components[0].id,
          ["a", "b", "c"][index],
        );
      });
    });

    it("单 component surfaceUpdate 原样返回", () => {
      const raw = JSON.stringify({
        surfaceUpdate: { surfaceId: "s1", components: [{ id: "a" }] },
      });
      assert.deepStrictEqual(normalizeMessageFrames(raw), [raw]);
    });

    it("非 surfaceUpdate 消息原样返回", () => {
      const raw = '{"beginRendering":{"surfaceId":"main","root":"a"}}';
      assert.deepStrictEqual(normalizeMessageFrames(raw), [raw]);
    });

    it("非法 JSON 原样返回，不静默丢弃", () => {
      assert.deepStrictEqual(normalizeMessageFrames('{"a":'), ['{"a":']);
    });

    it("空字符串原样返回（交由 parser 报错）", () => {
      assert.deepStrictEqual(normalizeMessageFrames(""), [""]);
    });

    it("JSON 原始值（字符串/数字/null/布尔）原样返回", () => {
      for (const raw of ['"hello"', "123", "null", "true"]) {
        assert.deepStrictEqual(normalizeMessageFrames(raw), [raw]);
      }
    });

    it("顶层数组原样返回", () => {
      const raw = '[{"id":"a"}]';
      assert.deepStrictEqual(normalizeMessageFrames(raw), [raw]);
    });

    it("surfaceUpdate 为 null / 原始值时原样返回", () => {
      assert.deepStrictEqual(normalizeMessageFrames('{"surfaceUpdate":null}'), [
        '{"surfaceUpdate":null}',
      ]);
      assert.deepStrictEqual(normalizeMessageFrames('{"surfaceUpdate":"x"}'), [
        '{"surfaceUpdate":"x"}',
      ]);
    });

    it("surfaceUpdate.components 缺失或不是数组时原样返回", () => {
      assert.deepStrictEqual(
        normalizeMessageFrames('{"surfaceUpdate":{"surfaceId":"s"}}'),
        ['{"surfaceUpdate":{"surfaceId":"s"}}'],
      );
      assert.deepStrictEqual(
        normalizeMessageFrames(
          '{"surfaceUpdate":{"surfaceId":"s","components":{"id":"a"}}}',
        ),
        ['{"surfaceUpdate":{"surfaceId":"s","components":{"id":"a"}}}'],
      );
    });

    it("components 为空数组时原样返回", () => {
      const raw = '{"surfaceUpdate":{"surfaceId":"s","components":[]}}';
      assert.deepStrictEqual(normalizeMessageFrames(raw), [raw]);
    });

    it("拆分时仅保留 surfaceId 与 components，surfaceUpdate 中额外字段丢弃", () => {
      const raw = JSON.stringify({
        surfaceUpdate: {
          surfaceId: "s1",
          version: 1,
          traceId: "t-1",
          components: [{ id: "a" }, { id: "b" }],
        },
      });
      const lines = normalizeMessageFrames(raw);
      assert.strictEqual(lines.length, 2);
      for (const line of lines) {
        const update = JSON.parse(line).surfaceUpdate;
        assert.deepStrictEqual(Object.keys(update), [
          "surfaceId",
          "components",
        ]);
      }
    });

    it("surfaceId 缺失时拆分不崩溃，输出中同样无 surfaceId 键", () => {
      const raw = JSON.stringify({
        surfaceUpdate: { components: [{ id: "a" }, { id: "b" }] },
      });
      const lines = normalizeMessageFrames(raw);
      assert.strictEqual(lines.length, 2);
      for (const line of lines) {
        const update = JSON.parse(line).surfaceUpdate;
        assert.strictEqual("surfaceId" in update, false);
        assert.strictEqual(update.components.length, 1);
      }
    });

    it("拆分出的首条消息结构与内容完整（单动作键 + 单 component）", () => {
      const lines = normalizeMessageFrames(multiLine);
      assert.deepStrictEqual(JSON.parse(lines[0]), {
        surfaceUpdate: {
          surfaceId: "s1",
          components: [{ id: "a", component: { Text: {} } }],
        },
      });
    });
  });

  describe("createJsonStreamBuffer - 分片集成", () => {
    it("50 字符分片累积，消息按 component 拆分后逐条就绪，无滞留", () => {
      const full =
        JSON.stringify({
          surfaceUpdate: {
            surfaceId: "m",
            components: [
              {
                id: "a",
                component: { Text: { text: { literalString: "甲" } } },
              },
              {
                id: "b",
                component: { Text: { text: { literalString: "乙" } } },
              },
            ],
          },
        }) +
        "\n" +
        JSON.stringify({ beginRendering: { surfaceId: "m", root: "a" } });

      const buffer = createJsonStreamBuffer();
      const ready: string[] = [];
      for (let i = 0; i < full.length; i += 50) {
        ready.push(...buffer.push(full.slice(i, i + 50)));
      }

      assert.strictEqual(buffer.hasPending(), false);
      // 2 个 component 拆开 + 1 条 beginRendering
      assert.strictEqual(ready.length, 3);

      // 拆分出的 JSONL 可直接被有状态 parser 逐条解析
      const parser = createParser();
      let last = parser.getResult();
      for (const line of ready) last = parser.parse(line);
      assert.strictEqual(last.hydrateNodes.length, 2);
      assert.deepStrictEqual(
        last.hydrateNodes.map((node) => node.componentId),
        ["a", "b"],
      );
    });

    it("reset 清空滞留分片", () => {
      const buffer = createJsonStreamBuffer();
      buffer.push('{"a":');
      assert.strictEqual(buffer.hasPending(), true);
      buffer.reset();
      assert.strictEqual(buffer.hasPending(), false);
    });

    it("初始无滞留", () => {
      assert.strictEqual(createJsonStreamBuffer().hasPending(), false);
    });

    it("push 空字符串或纯空白：无输出、无滞留", () => {
      const buffer = createJsonStreamBuffer();
      assert.deepStrictEqual(buffer.push(""), []);
      assert.deepStrictEqual(buffer.push("  \r\n\t"), []);
      assert.strictEqual(buffer.hasPending(), false);
    });

    it("单次 push 含两条完整消息：按顺序一次交付", () => {
      const buffer = createJsonStreamBuffer();
      assert.deepStrictEqual(buffer.push('{"a":1}\n{"b":2}'), [
        '{"a":1}',
        '{"b":2}',
      ]);
      assert.strictEqual(buffer.hasPending(), false);
    });

    it("一条消息跨两次 push 续帧：首次无输出，补齐后交付完整帧", () => {
      const buffer = createJsonStreamBuffer();
      assert.deepStrictEqual(buffer.push('{"a":'), []);
      assert.strictEqual(buffer.hasPending(), true);
      assert.deepStrictEqual(buffer.push("1}"), ['{"a":1}']);
      assert.strictEqual(buffer.hasPending(), false);
    });

    it("多 component surfaceUpdate 被任意小分片切断，最终按 component 顺序逐条交付", () => {
      const full = JSON.stringify({
        surfaceUpdate: {
          surfaceId: "s",
          components: [{ id: "a" }, { id: "b" }, { id: "c" }],
        },
      });
      const buffer = createJsonStreamBuffer();
      const ready: string[] = [];
      // 每片 7 个字符，切分点必然跨越多个 JSON 结构
      for (let i = 0; i < full.length; i += 7) {
        ready.push(...buffer.push(full.slice(i, i + 7)));
      }
      assert.strictEqual(buffer.hasPending(), false);
      assert.strictEqual(ready.length, 3);
      assert.deepStrictEqual(
        ready.map((line) => JSON.parse(line).surfaceUpdate.components[0].id),
        ["a", "b", "c"],
      );
    });

    it("转义引号恰好跨分片：逐字符推送后解析值正确", () => {
      const tail = '"y"}';
      const buffer = createJsonStreamBuffer();
      const ready: string[] = [];
      for (const ch of '{"a":"x\\') ready.push(...buffer.push(ch));
      for (const ch of tail) ready.push(...buffer.push(ch));
      assert.strictEqual(ready.length, 1);
      assert.strictEqual(JSON.parse(ready[0]).a, 'x"y');
    });

    it("reset 后缓冲区可继续接收新流，旧滞留不影响后续成帧", () => {
      const buffer = createJsonStreamBuffer();
      buffer.push('{"a":');
      buffer.reset();
      assert.deepStrictEqual(buffer.push('{"z":9}'), ['{"z":9}']);
      assert.strictEqual(buffer.hasPending(), false);
    });

    it("逐字符推送整条流（surfaceUpdate + beginRendering）：无重复无丢失，parser 终态正确", () => {
      const full =
        JSON.stringify({
          surfaceUpdate: {
            surfaceId: "m",
            components: [
              { id: "a", component: { Text: {} } },
              { id: "b", component: { Text: {} } },
            ],
          },
        }) +
        "\n" +
        JSON.stringify({ beginRendering: { surfaceId: "m", root: "a" } });

      const buffer = createJsonStreamBuffer();
      const ready: string[] = [];
      for (const ch of full) ready.push(...buffer.push(ch));

      // 恰好 3 条交付（2 component 拆分 + beginRendering），每条只出现一次
      assert.strictEqual(ready.length, 3);
      assert.strictEqual(buffer.hasPending(), false);

      const parser = createParser();
      for (const line of ready) parser.parse(line);
      const result = parser.getResult();
      assert.strictEqual(result.hydrateNodes.length, 2);
      assert.strictEqual(result.trees[0].root?.node.componentId, "a");
    });
  });
});
