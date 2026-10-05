import type { Context } from "koa";
import type { AgUIEvent } from "./agui/events";

/**
 * SSE 输出流（Koa 适配）：
 * 接管底层 Node response，逐帧写出 AG-UI 事件。
 */
export interface SSEStream {
  /** 写出一个 AG-UI 事件为一帧 `data: <json>\n\n` */
  send(event: AgUIEvent): void;
  /** 结束响应 */
  end(): void;
  /** 客户端是否已断开 */
  readonly closed: boolean;
}

export function createSSEStream(ctx: Context): SSEStream {
    // 绕过 Koa 的响应处理，直接操作原生 res
    ctx.respond = false;
    const res = ctx.res;
    const req = ctx.req;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 禁用 nginx 缓冲，保证流式即时下发
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    return {
      send(event: AgUIEvent) {
        if (closed) return;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      end() {
        if (!closed) res.end();
      },
      get closed() {
        return closed;
      },
    };
}
