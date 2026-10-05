import type { AgentRunInput, A2UIAgent } from "./types";

/** 每条消息之间的模拟生成延迟（ms），使流式过程可观察 */
const MOCK_MESSAGE_DELAY_MS = 100;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mock Agent：不调用真实 LLM，按用户输入生成一段固定形态的 A2UI 协议。
 *
 * 生成的页面：
 *   Column
 *   ├── 标题 Text "A2UI Server · mock agent"（h2）
 *   ├── 回显 Text path /echo       ← 用户输入被写入 dataModel
 *   ├── 状态 Text path /status
 *   └── Button：action.localUpdate 本地把 /status 更新为 "Updated locally"
 *
 * 每条 A2UI 消息作为一个异步产出，调用方（AG-UI encoder）逐条封装后推给 SSE。
 */
export class MockAgent implements A2UIAgent {
  async *run(input: AgentRunInput): AsyncGenerator<string> {
    const echo = input.input.trim() || "(empty input)";

    // 1. dataModelUpdate：回显用户输入 + 初始状态
    yield JSON.stringify({
      dataModelUpdate: {
        surfaceId: "main",
        path: "/",
        contents: [
          { key: "echo", valueString: echo },
          { key: "status", valueString: "Status: not updated yet" },
        ],
      },
    });
    await delay(MOCK_MESSAGE_DELAY_MS);

    // 2. root Column
    yield JSON.stringify({
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "root",
            component: {
              Column: {
                children: {
                  explicitList: [
                    "page_title",
                    "echo_text",
                    "status_text",
                    "update_button",
                  ],
                },
                distribution: "start",
                alignment: "stretch",
              },
            },
          },
        ],
      },
    });
    await delay(MOCK_MESSAGE_DELAY_MS);

    // 3. 标题
    yield JSON.stringify({
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "page_title",
            component: {
              Text: {
                text: { literalString: "A2UI Server · mock agent" },
                usageHint: "h2",
              },
            },
          },
        ],
      },
    });
    await delay(MOCK_MESSAGE_DELAY_MS);

    // 4. 回显用户输入的 Text
    yield JSON.stringify({
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "echo_text",
            component: { Text: { text: { path: "/echo" } } },
          },
        ],
      },
    });
    await delay(MOCK_MESSAGE_DELAY_MS);

    // 5. 状态 Text
    yield JSON.stringify({
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "status_text",
            component: { Text: { text: { path: "/status" } } },
          },
        ],
      },
    });
    await delay(MOCK_MESSAGE_DELAY_MS);

    // 6. 本地更新按钮（action.localUpdate）
    yield JSON.stringify({
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "update_button",
            component: {
              Button: {
                child: "update_label",
                action: {
                  name: "update_status",
                  localUpdate: {
                    path: "/status",
                    value: { literalString: "Status: updated locally" },
                  },
                },
              },
            },
          },
        ],
      },
    });
    await delay(MOCK_MESSAGE_DELAY_MS);

    // 7. 按钮文案
    yield JSON.stringify({
      surfaceUpdate: {
        surfaceId: "main",
        components: [
          {
            id: "update_label",
            component: {
              Text: { text: { literalString: "Update status locally" } },
            },
          },
        ],
      },
    });
    await delay(MOCK_MESSAGE_DELAY_MS);

    // 8. beginRendering
    yield JSON.stringify({
      beginRendering: { surfaceId: "main", root: "root" },
    });
  }
}
