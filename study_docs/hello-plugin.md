# Hello 插件开发指南（OpenCode）

目标：手写一个最小可运行的 **Hello 插件**，能输出日志、注册工具并被调用。

## 1. 插件放置位置

推荐（项目内）：

- `.opencode/plugins/*.ts`（官方文档）

兼容：

- `.opencode/plugin/*.ts`（项目内部也支持）

全局：

- `~/.config/opencode/plugins/`

也可以在 `opencode.jsonc` 中显式声明：

```json
{
  "plugin": ["file:///绝对路径/your-plugin.ts"]
}
```

## 2. 最小 Hello 插件

文件：`.opencode/plugins/hello.ts`

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const HelloPlugin: Plugin = async (input) => {
  const log = (text: string, extra?: Record<string, unknown>) => {
    return input.client.app.log({
      body: {
        service: "plugin.hello",
        level: "info",
        message: `核心/插件/${text}`,
        extra,
      },
    })
  }

  log("加载", { directory: input.directory, worktree: input.worktree }).catch(() => undefined)

  return {
    tool: {
      hello: tool({
        description: "返回 hello 文本",
        args: {
          name: tool.schema.string().optional().describe("名字(可选)"),
        },
        async execute(args, ctx) {
          await log("工具/执行", { tool: "hello", session: ctx.sessionID, name: args.name ?? "" }).catch(
            () => undefined,
          )
          const name = args.name ? ` ${args.name}` : ""
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
```

## 3. 启动与验证

1) 启动：

```
bun run dev -- --log-level DEBUG
```

2) 看日志：

```
tail -f ~/.local/share/opencode/log/dev.log | tr -d '\000' | grep -E "核心/插件|plugin.hello"
```

3) 触发工具调用（在对话里输入）：

```
请调用工具 hello，name=测试
```

## 4. 常见坑

- **app.log 必须带 body**，否则日志不会写入
- **插件只在启动时加载一次**，改代码需重启
- 如果 grep 没结果，用 `tr -d '\000'` 清理 NUL 字节
