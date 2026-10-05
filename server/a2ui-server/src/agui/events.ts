/**
 * AG-UI（Agent-User Interaction Protocol）事件模型
 *
 * 参考 https://docs.ag-ui.com/concepts/events：
 * 每个事件是一个带 `type`（大写下划线）的 JSON 对象，通过 SSE 的
 * `data: <json>\n\n` 帧逐条传输。这里只定义 a2ui-server 当前使用的子集。
 */

export interface AgUIBaseEvent {
  type: string;
  /** ISO 8601 时间戳（AG-UI 事件可携带的公共元数据） */
  timestamp: string;
}

/** 运行开始（首个事件，必须） */
export interface RunStartedEvent extends AgUIBaseEvent {
  type: "RUN_STARTED";
  threadId: string;
  runId: string;
  /** 触发本次运行的用户输入（AG-UI 扩展字段，可选） */
  input?: string;
}

/** 运行正常结束（末个事件，成功时必须） */
export interface RunFinishedEvent extends AgUIBaseEvent {
  type: "RUN_FINISHED";
  threadId: string;
  runId: string;
}

/** 运行失败（异常时替代 RUN_FINISHED） */
export interface RunErrorEvent extends AgUIBaseEvent {
  type: "RUN_ERROR";
  message: string;
  code?: string;
}

/**
 * 自定义事件：承载 A2UI 业务载荷。
 * name 固定为 "a2ui"，value 为一条解析后的 A2UI server→client 消息。
 */
export interface A2UICustomEvent extends AgUIBaseEvent {
  type: "CUSTOM";
  name: "a2ui";
  value: unknown;
}

export type AgUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | A2UICustomEvent;
