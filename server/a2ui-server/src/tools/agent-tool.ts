/**
 * MCP 风格 Agent 工具抽象：
 * 每个工具以 OpenAI function-calling 的形态暴露给模型（name / description /
 * JSON Schema 参数），模型返回 tool_call 后由 agent 调 execute 执行，
 * 结果以字符串（通常为 JSON）回灌给模型。
 *
 * 与真实 MCP server 的区别：这里是进程内直接注册的本地工具，
 * 但工具描述/参数 schema/调用返回的协议形态与 MCP tool 一致，
 * 后续可平滑替换为远端 MCP client。
 */

/** 工具参数 JSON Schema（function parameters） */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      default?: unknown;
    }
  >;
  required?: string[];
}

export interface AgentTool {
  /** 工具名（function.name），模型据此发起 tool_call */
  name: string;
  /** 工具说明（function.description），告诉模型何时/如何使用 */
  description: string;
  /** 参数 JSON Schema */
  parameters: ToolParameterSchema;
  /** 执行工具：args 为模型给出的已解析参数，返回字符串结果 */
  execute(args: Record<string, unknown>): Promise<string>;
}

/** 转换为 OpenAI function tool 定义（发送给 chat.completions 的 tools 参数） */
export function toOpenAITool(tool: AgentTool): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
} {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
