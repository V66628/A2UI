import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorType } from "../../src/store/types.js";
import { parseProtocol, type UserAction } from "../../src/parser/index.js";

const mockPath = fileURLToPath(
  new URL("../../mock/text-v0.8.jsonl", import.meta.url)
);
const mockJsonl = readFileSync(mockPath, "utf8");
const serverSurfaceUpdate = mockJsonl.trim().split("\n")[0];

describe("A2UI parser - client→server 消息分开处理", () => {
  describe("userAction", () => {
    const userActionLine = JSON.stringify({
      userAction: {
        name: "submit",
        surfaceId: "main",
        sourceComponentId: "btn-1",
        timestamp: "2025-09-28T10:00:00Z",
        context: { value: "ok" },
      },
    });

    it("应解析为 1 个 clientEvent，类型为 userAction", () => {
      const result = parseProtocol(userActionLine);
      assert.strictEqual(result.clientEvents.length, 1);
      assert.strictEqual(result.clientEvents[0].type, "userAction");
    });

    it("payload 应包含全部结构化字段", () => {
      const result = parseProtocol(userActionLine);
      const payload = result.clientEvents[0].payload as UserAction;
      assert.strictEqual(payload.name, "submit");
      assert.strictEqual(payload.surfaceId, "main");
      assert.strictEqual(payload.sourceComponentId, "btn-1");
      assert.strictEqual(payload.timestamp, "2025-09-28T10:00:00Z");
      assert.deepStrictEqual(payload.context, { value: "ok" });
    });

    it("protocol 应保留协议原文", () => {
      const result = parseProtocol(userActionLine);
      assert.strictEqual(result.clientEvents[0].protocol, userActionLine);
    });

    it("client→server 消息不应创建 surface 或 hydrateNode", () => {
      const result = parseProtocol(userActionLine);
      assert.strictEqual(result.surfaces.length, 0);
      assert.strictEqual(result.hydrateNodes.length, 0);
    });
  });

  describe("error 上报", () => {
    const errorLine = JSON.stringify({
      error: { content: "render failed", code: 500 },
    });

    it("应解析为类型 error 的 clientEvent，内容灵活保留", () => {
      const result = parseProtocol(errorLine);
      assert.strictEqual(result.clientEvents.length, 1);
      assert.strictEqual(result.clientEvents[0].type, "error");
      assert.deepStrictEqual(result.clientEvents[0].payload, {
        content: "render failed",
        code: 500,
      });
    });
  });

  describe("非法 userAction", () => {
    it("缺少必填 context 应记录 PARSE_ERROR，且不产生 clientEvent", () => {
      const badLine = JSON.stringify({
        userAction: {
          name: "submit",
          surfaceId: "main",
          sourceComponentId: "btn-1",
          timestamp: "2025-09-28T10:00:00Z",
        },
      });
      const result = parseProtocol(badLine);
      assert.strictEqual(result.clientEvents.length, 0);
      assert.strictEqual(result.errors[0].type, ErrorType.PARSE_ERROR);
    });
  });

  describe("两个方向混合的 JSONL 流", () => {
    const userActionLine = JSON.stringify({
      userAction: {
        name: "submit",
        surfaceId: "main",
        sourceComponentId: "btn-1",
        timestamp: "2025-09-28T10:00:00Z",
        context: {},
      },
    });

    it("server 消息进 surfaces，client 消息进 clientEvents，互不干扰", () => {
      const result = parseProtocol(`${serverSurfaceUpdate}\n${userActionLine}`);
      assert.strictEqual(result.surfaces.length, 1);
      assert.strictEqual(result.hydrateNodes.length, 1);
      assert.strictEqual(result.clientEvents.length, 1);
      assert.strictEqual(result.errors.length, 0);
    });
  });

  describe("未知消息类型", () => {
    it("既非 server 也非 client 的键应记录 PARSE_ERROR", () => {
      const result = parseProtocol(JSON.stringify({ weirdMessage: {} }));
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].type, ErrorType.PARSE_ERROR);
    });
  });
});
