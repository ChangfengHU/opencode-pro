# 日志集成指南（OpenCode）

目标：在本地开发时稳定看到 **核心流程**、**插件**、**工具**、**LLM** 相关日志，并能快速过滤与排查。

## 1. 日志位置与文件

- 本地日志目录：`~/.local/share/opencode/log/`
- 开发模式（`bun run dev`）通常写入 `dev.log`
- 其他模式会写入时间戳文件（形如 `2026-02-02T130000.log`）

## 2. 推荐写法：`client.app.log()`（插件内）

插件日志推荐走 `app.log` 接口，统一进入 Opencode 日志系统。  
**注意：参数必须放到 `body` 内**。

```ts
await input.client.app.log({
  body: {
    service: "plugin.minimal",
    level: "info",
    message: "核心/插件/加载",
    extra: { directory: input.directory },
  },
})
```

### 必须字段

- `service`: 服务名
- `level`: `debug | info | warn | error`
- `message`: 日志内容
- `extra`: 可选附加字段

### 不推荐的方式

- `console.log`：不进入统一日志
- `Bun.write(dev.log)`：会与内部 writer 冲突，可能产生 NUL 字节，导致 `grep`/`rg` 匹配失败

## 3. 日志级别

启动时提升日志级别：

```
bun run dev -- --log-level DEBUG
```

## 4. 常用查看命令

实时查看：

```
tail -f ~/.local/share/opencode/log/dev.log | grep "核心/"
```

遇到 NUL 字节（grep 无输出）：

```
tail -f ~/.local/share/opencode/log/dev.log | tr -d '\000' | grep "核心/"
```

如果没有 `rg`：

```
grep -a "核心/" ~/.local/share/opencode/log/dev.log
```

## 5. 推荐的日志规范

统一关键词：`核心/`  
建议结构：`核心/域/动作`

示例：

- `核心/插件/加载`
- `核心/插件/工具/执行`
- `核心/LLM/请求开始`
- `核心/LLM/响应原文`
- `核心/工具/调用`

## 6. 常见问题排查

1) **看不到插件日志**
- 先确认插件已加载（日志里应有 `service=plugin ... loading plugin`）
- 确认 `app.log` 使用了 `body` 包装
- 提升日志级别并重启

2) **只看到 `/log` 请求，没有内容**
- 多半是请求体校验失败（缺少 `body`）

3) **grep 搜不到**
- 日志中有 NUL 字节，使用 `tr -d '\000'` 再过滤
