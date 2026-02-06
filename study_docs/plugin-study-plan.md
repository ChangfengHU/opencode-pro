# OpenCode 插件学习计划（基于官方文档）

目标：理解插件加载、编写、工具注册、日志、Hook 扩展与调试流程，具备独立开发插件的能力。

> 参考文档：`https://opencode.ai/docs/plugins/`

## 教学计划（循序渐进）

### 1. 插件体系与加载方式
- 了解插件放置目录与加载顺序
- 熟悉 `opencode.jsonc` 的 `plugin` 配置
- 验证插件是否被加载（日志中出现 `loading plugin`）

### 2. 插件结构与上下文
- 理解 Plugin 函数签名与 `input` 内容（client/project/directory/worktree）
- 认识 Hook 的基本形态与异步执行方式

### 3. 自定义工具（tool helper）
- 使用 `tool` helper 注册一个新工具
- 认识 `args` schema 与 `execute` 的上下文
- 实战：创建 hello 工具

### 4. 插件日志与调试
- 使用 `client.app.log()` 打日志
- 熟悉日志级别与过滤方式
- 解决 “看不到日志” 的常见问题

### 5. 常用 Hook
- `chat.message`：新消息进入
- `tool.execute.before / after`：工具执行前后
- `permission.ask`：权限控制
- `command.execute.before`：命令执行前

### 6. Compaction 与系统提示词扩展
- `experimental.session.compacting`
- `experimental.chat.system.transform`
- `experimental.chat.messages.transform`

### 7. 打包与复用
- npm 插件的引入方式
- 插件版本与依赖
- 使用同一套插件管理多个项目

---

## 教学进度（我会同步更新）

- [ ] 1. 插件体系与加载方式
- [ ] 2. 插件结构与上下文
- [ ] 3. 自定义工具（tool helper）
- [ ] 4. 插件日志与调试
- [ ] 5. 常用 Hook
- [ ] 6. Compaction 与系统提示词扩展
- [ ] 7. 打包与复用

## 进度日志

| 日期 | 进度 | 说明 |
| --- | --- | --- |
| 2026-02-02 | 已创建计划 | 文档初始化 |

---

## 学习方式（我会主动引导）

1) 你完成每一步后，回复：  
   `完成：步骤 X`
2) 我会更新此文档中的进度与日志
3) 下一步会给你 **具体动手任务**

---

## 现在开始：第 1 步

**任务**  
1. 阅读官方插件文档的目录与加载方式说明  
2. 确认项目内存在 `.opencode/plugins/` 或 `.opencode/plugin/`  
3. 启动一次，确保日志中出现 `loading plugin`

**完成后回复**：`完成：步骤 1`
