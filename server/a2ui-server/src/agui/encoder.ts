import type {
  A2UICustomEvent,
  AgUIEvent,
  RunErrorEvent,
  RunFinishedEvent,
  RunStartedEvent,
} from "./events";

export interface EncodeOptions {
  threadId: string;
  runId: string;
  input: string;
}

/**
 * 把 A2UI 消息流编码为 AG-UI 事件流（传输层协议封装，业务层无侵入）：
 *
 *   RUN_STARTED
 *   CUSTOM { name:"a2ui", value:<A2UI 消息> }   ← 每条 A2UI 消息一帧
 *   ...
 *   RUN_FINISHED  （或异常时 RUN_ERROR）
 *
 * 结束条件显式化为边界事件，客户端可据此收敛状态机，
 * 不依赖连接断开或哨兵字符串。
 */
export async function* encodeAgUI(
  a2uiMessages: AsyncIterable<string>,
  options: EncodeOptions,
): AsyncGenerator<AgUIEvent> {
  const { threadId, runId, input } = options;

  const started: RunStartedEvent = {
    type: "RUN_STARTED",
    threadId,
    runId,
    input,
    timestamp: new Date().toISOString(),
  };
  yield started;

  try {
    for await (const raw of a2uiMessages) {
      // A2UI 消息为单行 JSON；解析后作为 CUSTOM 的 value
      const value: unknown = JSON.parse(raw) as unknown;
      const event: A2UICustomEvent = {
        type: "CUSTOM",
        name: "a2ui",
        value,
        timestamp: new Date().toISOString(),
      };
      yield event;
    }

    const finished: RunFinishedEvent = {
      type: "RUN_FINISHED",
      threadId,
      runId,
      timestamp: new Date().toISOString(),
    };
    yield finished;
  } catch (error) {
    const runError: RunErrorEvent = {
      type: "RUN_ERROR",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
    yield runError;
  }
}
