import os from "os"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  extractReasoningMiddleware,
  tool,
  jsonSchema,
} from "ai"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  const FULL_LOG = process.env.OPENCODE_LOG_LLM_FULL === "1"

  export const OUTPUT_TOKEN_MAX = Flag.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  const LOG_PREVIEW = 2000
  const LOG_DEPTH = 6

  function clipText(text: string, limit = LOG_PREVIEW) {
    const size = text.length
    if (size <= limit) {
      return { text, size, clipped: false }
    }
    return { text: text.slice(0, limit) + "...", size, clipped: true }
  }

  function isSecretKey(key: string) {
    const lower = key.toLowerCase()
    if (lower.includes("authorization")) return true
    if (lower.includes("apikey")) return true
    if (lower.includes("api_key")) return true
    if (lower.includes("token")) return true
    if (lower.includes("secret")) return true
    if (lower.includes("password")) return true
    if (lower.includes("cookie")) return true
    return lower.includes("key")
  }

  function redactValue(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value
    if (depth >= LOG_DEPTH) return "[max-depth]"
    if (typeof value === "string") return clipText(value)
    if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
    if (typeof value !== "object") return value
    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(record)) {
      if (isSecretKey(key)) {
        result[key] = "[redacted]"
        continue
      }
      result[key] = redactValue(record[key], depth + 1)
    }
    return result
  }

  function summarizeMessages(messages: ModelMessage[]) {
    const roles: Record<string, number> = {}
    const summary = {
      count: messages.length,
      roles,
      parts: 0,
      chars: 0,
      toolCalls: 0,
    }
    for (const msg of messages) {
      roles[msg.role] = (roles[msg.role] ?? 0) + 1
      const content = msg.content
      if (typeof content === "string") {
        summary.chars += content.length
        continue
      }
      if (!Array.isArray(content)) continue
      summary.parts += content.length
      for (const part of content) {
        if (part.type === "text") summary.chars += part.text.length
        if (part.type === "tool-call" || part.type === "tool-result") summary.toolCalls += 1
      }
    }
    return summary
  }

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const system = []
    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    const original = clone(system)
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens = isCodex ? undefined : undefined
    const systemText = system.join("\n\n")
    log.info("max_output_tokens", {
      tokens: ProviderTransform.maxOutputTokens(
        input.model.api.npm,
        params.options,
        input.model.limit.output,
        OUTPUT_TOKEN_MAX,
      ),
      modelOptions: params.options,
      outputLimit: input.model.limit.output,
    })
    // tokens = 32000
    // outputLimit = 64000
    // modelOptions={"reasoningEffort":"minimal"}

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const toolNames = Object.keys(tools)
    l.info("核心/LLM/请求开始", {
      sessionID: input.sessionID,
      message: {
        user: input.user.id,
        model: `${input.model.providerID}/${input.model.id}`,
      },
      system: clipText(systemText),
      messages: summarizeMessages(input.messages),
      tools: {
        count: toolNames.length,
        names: toolNames,
        liteProxy: isLiteLLMProxy,
      },
    })

    const providerOptions = ProviderTransform.providerOptions(input.model, params.options)
    const requestHeaders = {
      ...(input.model.providerID.startsWith("opencode")
        ? {
            "x-opencode-project": Instance.project.id,
            "x-opencode-session": input.sessionID,
            "x-opencode-request": input.user.id,
            "x-opencode-client": Flag.OPENCODE_CLIENT,
          }
        : input.model.providerID !== "anthropic"
          ? {
              "User-Agent": `opencode/${Installation.VERSION}`,
            }
          : undefined),
      ...input.model.headers,
        ...headers,
    }
    const requestMessages = [
      ...(isCodex
        ? [
            {
              role: "user",
              content: system.join("\n\n"),
            } as ModelMessage,
          ]
        : system.map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          )),
      ...input.messages,
    ]
    if (FULL_LOG) {
      l.info("核心/LLM/请求原文", {
        sessionID: input.sessionID,
        model: `${input.model.providerID}/${input.model.id}`,
        request: {
          temperature: params.temperature,
          topP: params.topP,
          topK: params.topK,
          providerOptions,
          headers: Object.keys(requestHeaders),
          activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
          messages: requestMessages,
        },
      })
    }
    l.debug("核心/LLM/请求参数", {
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      options: redactValue(params.options),
      providerOptions: redactValue(providerOptions),
      headers: Object.keys(requestHeaders),
    })

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions,
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: requestHeaders,
      maxRetries: input.retries ?? 0,
      messages: requestMessages,
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      }),
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
