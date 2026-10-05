import { createParseContext, type ParseContext } from "./context.js";
import { commitLocalWrite } from "./data-model.js";
import { processInput, snapshotContext } from "./line.js";
import {
  getActionSink,
  getDataModelBridge,
  getLocalChangeNotifier,
  getTreeRenderer,
  setEngineHooks,
  setRenderMap,
  setTreeRenderer,
  type TreeRenderFunction,
} from "./render-registry.js";
import { rerenderAllNodes } from "./server-messages.js";
import type { ParseResult, UserAction } from "./types.js";

export * from "./types.js";
export * from "./binding.js";
export * from "./data-model.js";
export * from "./action.js";
export * from "./template.js";
export * from "./stream-buffer.js";
export { setRenderMap, setTreeRenderer, type TreeRenderFunction };

/**
 * 有状态的 A2UI parser
 *
 * parser 天然支持不断调用：内部持有持久的解析上下文，每次 parse 的消息
 * 都会累积；同 componentId 的组件再次出现时会被更新替换，组件树随之刷新。
 * 适用于真实 stream / SSE：到达一条消息即 parse 一条。
 */
export interface A2Parser {
  /** 处理一条消息（JSONL 字符串行，或已解析的消息对象），返回当前快照 */
  parse(input: string | Record<string, unknown>): ParseResult;
  /** 获取当前快照（不新增消息） */
  getResult(): ParseResult;
  /** 清空累积状态，恢复为初始上下文 */
  reset(): void;
}

/** 创建一个有状态 parser */
export function createParser(): A2Parser {
  let ctx: ParseContext = createParseContext();

  /**
   * 本地变化 cycle（交互组件触发，无新协议消息）：
   * rerenderAllNodes（全部节点用最新 dataModel 重渲染）→ snapshot →
   * treeRenderer（SDK 内部驱动渲染）→ localChangeNotifier（host mirror 进 store）。
   */
  const runLocalCycle = (): ParseResult => {
    rerenderAllNodes(ctx);
    const result = snapshotContext(ctx);
    const renderTree = getTreeRenderer();
    if (renderTree) {
      for (const tree of result.trees) renderTree(tree);
    }
    getLocalChangeNotifier()?.(result);
    return result;
  };

  // 注册引擎钩子：renderMap 交互组件的回调经此到达当前 parser 实例
  setEngineHooks({
    commitLocalWrite(surfaceId, path, value) {
      const surface = ctx.surfaceMap.get(surfaceId);
      if (!surface) return;
      // 中心 store 为数据源：经桥写入后同步 ctx 引用，再跑本地渲染 cycle；
      // 无桥（独立 parser）时直接写 ctx surface。
      const bridge = getDataModelBridge();
      if (bridge) {
        bridge.commitLocalWrite(surfaceId, path, value);
        surface.dataModel = bridge.getDataModel(surfaceId);
      } else {
        commitLocalWrite(surface, path, value);
      }
      runLocalCycle();
    },
    dispatchUserAction(surfaceId, sourceComponentId, name, context) {
      const action: UserAction = {
        name,
        surfaceId,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context,
      };
      getActionSink()?.(action);
    },
  });

  return {
    parse(input) {
      processInput(ctx, input);
      // 刷新全部节点 vnode：更新后的组件与新到达的子引用需生成全新元素对象，
      // React 才不会因元素引用不变而 bail-out、跳过重新渲染
      rerenderAllNodes(ctx);
      const result = snapshotContext(ctx);
      // 渲染时机由 SDK 掌握：每次 treebuild 完成后，把组件树交给 init 注入的
      // 渲染函数（未注入则跳过）
      const renderTree = getTreeRenderer();
      if (renderTree) {
        for (const tree of result.trees) renderTree(tree);
      }
      return result;
    },
    getResult() {
      return snapshotContext(ctx);
    },
    reset() {
      ctx = createParseContext();
    },
  };
}

/**
 * 一次性解析整段 JSONL 协议（内部即创建 parser 逐行 parse）
 *
 * A2UI 以 JSON Lines 传输：每行一个 JSON 消息，空行忽略；
 * 任意单行错误记录为 PARSE_ERROR，不中断整段解析。
 */
export function parseProtocol(jsonl: string): ParseResult {
  const parser = createParser();
  for (const line of jsonl.split(/\r?\n/)) parser.parse(line);
  return parser.getResult();
}
