import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const MinimalPlugin: Plugin = async (input) => {
  const log = (text: string, extra?: Record<string, unknown>) => {
    return input.client.app.log({
      body: {
        service: "plugin.minimal",
        level: "info",
        message: `核心/插件/${text}`,
        extra,
      },
    })
  }

  log("加载", {
    directory: input.directory,
    worktree: input.worktree,
  }).catch(() => undefined)
  return {
    tool: {
      hello: tool({
        description: "返回插件测试文本",
        args: {
          name: tool.schema.string().optional().describe("名字(可选)"),
        },
        async execute(args, ctx) {
          const name = args.name ? ` ${args.name}` : ""
          await log("工具/执行", {
            tool: "hello",
            session: ctx.sessionID,
            name: args.name ?? "",
          }).catch(() => undefined)
          return `hello${name}`
        },
      }),
    },
    "chat.message": async (input, output) => {
      await log("消息进入", {
        session: input.sessionID,
        agent: input.agent ?? "",
        model: input.model ? `${input.model.providerID}/${input.model.modelID}` : "",
        parts: output.parts.length,
      }).catch(() => undefined)
    },
  }
}
