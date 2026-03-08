# SPEC: Multi-Provider Abstraction for T3 Code — Amazon Bedrock Integration

> Portable implementation contract. An AI coding agent can implement this without follow-up questions.

**Status**: Draft v1.0
**Companion files**: [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) · [TEST_MATRIX.md](./TEST_MATRIX.md)

---

## 1. Problem Statement

T3 Code is a web GUI for code agents. Today it is hard-wired to a single provider — **OpenAI Codex** — via the `codex app-server` CLI subprocess. Users who only have **Amazon Bedrock** credentials (or any non-OpenAI provider) cannot use T3 Code at all.

The Codex CLI handles everything end-to-end: API calls, tool execution (file edits, shell commands), streaming, session persistence. There is no abstraction layer that allows plugging in a different AI backend.

This spec defines a **multi-provider abstraction** that lets users choose between Codex and Bedrock (and future providers) with **zero functional degradation** — identical tool execution, streaming, session persistence, and approval modes regardless of which provider is active.

---

## 2. Goals and Non-Goals

### Goals

1. **Add `"bedrock"` as a second `ProviderKind`** alongside `"codex"`, selectable per-session.
2. **Full tool execution parity**: `file_read`, `file_write`, `file_edit`, `shell`, `browser` — same as Codex.
3. **Identical approval modes**: `approval-required`, `full-auto`, `auto-approve` with allowlists.
4. **Session persistence**: Bedrock conversation history persisted to disk, survives server restart.
5. **1:1 DomainEvent mapping**: AI SDK streaming responses translated to existing event types — no UI changes required.
6. **Directory sandboxing**: Bedrock tool execution restricted to project directory + approval modes.
7. **Credential resolution**: AWS credentials via env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) and/or config file.
8. **Model validation**: Probe Bedrock model availability at startup when credentials present; fall back to clear error on first turn.
9. **Automatic project context**: System prompt includes file tree, git status, README — same as Codex workspace awareness.
10. **Unified model picker**: UI shows models from all configured providers; user picks per-session.

### Non-Goals

- **Browser tool beyond basic fetch**: The `browser` tool provides URL fetching and text extraction. Full interactive browser automation (clicking, form filling, JavaScript execution) is out of scope for v1.
- **MCP (Model Context Protocol) support for Bedrock**: Codex-specific feature, out of scope.
- **Multi-turn tool-use planning**: The BedrockAdapter executes tool calls as they arrive from the model. No autonomous multi-step planning beyond what the model itself orchestrates.
- **Provider-specific UI sections**: No Bedrock-branded panels. The UI is provider-agnostic.
- **Custom fine-tuned model support**: Only standard Bedrock foundation models.
- **Cost tracking / token metering**: Out of scope.

---

## 3. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        apps/web (React)                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐ │
│  │Model     │  │Session   │  │Conversation│  │Approval    │ │
│  │Picker    │  │Manager   │  │Renderer    │  │Dialog      │ │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘  └─────┬──────┘ │
│       └──────────────┴──────────────┴───────────────┘        │
│                         WebSocket                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                     apps/server (Node.js)                     │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              OrchestrationEngine (CQRS)                  │ │
│  │  Commands → Decider → Events → Projections → PubSub     │ │
│  └───────────────────────┬─────────────────────────────────┘ │
│                          │                                    │
│  ┌───────────────────────┴─────────────────────────────────┐ │
│  │              ProviderService (facade)                     │ │
│  │  Routes to adapter via ProviderAdapterRegistry            │ │
│  └──────┬────────────────────────────────┬─────────────────┘ │
│         │                                │                    │
│  ┌──────┴──────┐                  ┌──────┴──────────────┐    │
│  │CodexAdapter │                  │BedrockAdapter (NEW)  │    │
│  │             │                  │                      │    │
│  │ codex       │                  │ @ai-sdk/             │    │
│  │ app-server  │                  │ amazon-bedrock       │    │
│  │ (stdio)     │                  │ + ToolExecutor       │    │
│  │             │                  │ + SessionStore       │    │
│  └─────────────┘                  │ + EventTranslator    │    │
│                                   └──────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Shared Services                              │ │
│  │  ToolExecutor · SessionStore · CredentialResolver         │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Component Inventory

| Component | Package | New/Modified | Purpose |
|---|---|---|---|
| `ProviderKind` | `packages/contracts` | Modified | Add `"bedrock"` literal |
| `BedrockModelCatalog` | `packages/contracts` | New | Bedrock model definitions |
| `ProviderCredential` | `packages/contracts` | New | Credential schemas per provider |
| `BedrockAdapter` | `apps/server` | New | Implements `ProviderAdapter` for Bedrock |
| `ToolExecutor` | `apps/server` | New | Server-side tool execution engine |
| `BedrockSessionStore` | `apps/server` | New | Conversation persistence |
| `EventTranslator` | `apps/server` | New | AI SDK stream → `ProviderRuntimeEvent` |
| `CredentialResolver` | `apps/server` | New | AWS credential chain resolution |
| `SystemPromptBuilder` | `apps/server` | New | Project context assembly |
| `ProviderAdapterRegistry` | `apps/server` | Modified | Route `"bedrock"` → `BedrockAdapter` |
| `model.ts` helpers | `packages/shared` | Modified | Add Bedrock model resolution |
| Model Picker | `apps/web` | Modified | Show models from all providers |
| Settings Panel | `apps/web` | Modified | AWS credential input |

### External Dependencies (New)

| Package | Version | Purpose |
|---|---|---|
| `ai` | `^5.x` | Vercel AI SDK core |
| `@ai-sdk/amazon-bedrock` | `^2.x` | Bedrock provider for AI SDK |
| `@aws-sdk/credential-providers` | `^3.x` | AWS credential chain (`fromNodeProviderChain`) |

---

## 4. Core Domain Model

> Full entity definitions with types, defaults, and validation in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md).

### 4.1 ProviderKind (Modified)

```
ProviderKind = "codex" | "bedrock"
DEFAULT_PROVIDER_KIND = "codex"
```

> **Important boundary**: Adding a new ProviderKind value requires updating: contracts schema, model catalog, adapter registry, provider health, UI model picker. This is intentional — providers are not auto-discovered.

### 4.2 Key Entities

- **`ProviderCredential`** — Per-provider credential bag. For Bedrock: `accessKeyId`, `secretAccessKey`, `region`, optional `sessionToken`.
- **`BedrockModel`** — Model metadata: `id` (Bedrock format like `anthropic.claude-opus-4-5-20251101-v1:0`), `slug` (display name), `capabilities` (reasoning, attachments, tool_use).
- **`BedrockSession`** — In-memory session state: conversation history, model config, turn counter, tool results. Persisted via `BedrockSessionStore`.
- **`ToolDefinition`** — Tool schema sent to Bedrock: name, description, input JSON schema.
- **`ToolResult`** — Execution result returned to model: tool_use_id, output string, is_error flag.

---

## 5. Provider Abstraction Contract

### 5.1 ProviderAdapter Interface (Existing — No Changes)

Every adapter implements this interface. The `BedrockAdapter` must conform exactly:

```
interface ProviderAdapter:
  capabilities: ProviderAdapterCapabilities
  startSession(input: ProviderSessionStartInput): ProviderSession
  sendTurn(input: ProviderSendTurnInput): ProviderTurnStartResult
  interruptTurn(threadId, turnId): void
  readThread(threadId): ProviderThreadTurnSnapshot
  rollbackThread(threadId, turnId): void
  respondToRequest(threadId, requestId, decision): void
  respondToUserInput(threadId, requestId, answers): void
  stopSession(threadId): void
  listSessions(): ProviderSession[]
  hasSession(threadId): boolean
  stopAll(): void
  streamEvents(): Stream<ProviderRuntimeEvent>
```

### 5.2 BedrockAdapter Capabilities

```
BedrockAdapterCapabilities:
  sessionModelSwitch: "restart-session"
```

> **Important nuance**: Unlike Codex (which supports in-session model switching), Bedrock sessions are tied to a model at creation. Changing models requires starting a new session. The UI should handle this by offering "start new session with different model" rather than silently restarting.

### 5.3 Adapter Registration

In `ProviderAdapterRegistry`, the lookup changes from:

```
"codex" → CodexAdapter
```

To:

```
"codex"   → CodexAdapter
"bedrock" → BedrockAdapter
```

Registration is static — no dynamic plugin loading.

---

## 6. Tool Execution Engine

### 6.1 Overview

The `ToolExecutor` is a new shared service that executes tool calls on behalf of the BedrockAdapter. It receives tool-call requests from the AI SDK stream, executes them (with approval flow if needed), and returns results to continue the conversation.

> **Important boundary**: The ToolExecutor is used ONLY by non-Codex adapters. Codex handles tool execution internally via its own app-server subprocess.

### 6.2 Tool Definitions

Five tools are exposed to Bedrock models:

#### `file_read`
- **Description**: Read the contents of a file at a given path relative to the project root.
- **Input**: `{ path: string }` — relative path, must resolve within project directory.
- **Output**: File contents as string. Error string if file doesn't exist.
- **Approval**: Never requires approval (read-only).
- **Sandbox rule**: Path must resolve to within `projectDir` after canonicalization. Reject `../` escapes.

#### `file_write`
- **Description**: Create or overwrite a file at a given path.
- **Input**: `{ path: string, content: string }` — relative path + full file content.
- **Output**: `"File written: {path}"` or error string.
- **Approval**: Requires approval in `approval-required` mode. Auto-approved in `full-auto`. In `auto-approve`, auto-approved if path matches allowlist pattern.
- **Sandbox rule**: Path must resolve within `projectDir`. Parent directories created automatically.

#### `file_edit`
- **Description**: Apply a targeted edit to an existing file using search/replace.
- **Input**: `{ path: string, old_text: string, new_text: string }` — finds `old_text` in file, replaces first occurrence with `new_text`.
- **Output**: `"Edit applied to {path}"` or error if `old_text` not found.
- **Approval**: Same as `file_write`.
- **Sandbox rule**: Same as `file_write`.

#### `shell`
- **Description**: Execute a shell command in the project directory.
- **Input**: `{ command: string }` — shell command string.
- **Output**: Combined stdout+stderr, truncated to 10000 chars. Exit code appended.
- **Approval**: Always requires approval in `approval-required` mode. Auto-approved in `full-auto`. In `auto-approve`, auto-approved if command matches allowlist pattern.
- **Sandbox rule**: Working directory is always `projectDir`. No `cd` escape prevention beyond approval.
- **Timeout**: `shell_timeout_ms` (default: `120000` — 2 minutes). Kill process on timeout.

#### `browser`
- **Description**: Fetch a URL and extract its text content. Useful for reading documentation, API references, or web pages.
- **Input**: `{ url: string }` — absolute HTTP/HTTPS URL.
- **Output**: Extracted text content from the page, truncated to 15000 chars. Error string if fetch fails.
- **Approval**: Requires approval in `approval-required` mode. Auto-approved in `full-auto` and `auto-approve` (network read-only).
- **Implementation**: Uses `fetch()` to GET the URL, then extracts text via HTML-to-text conversion (strip tags, scripts, styles). No JavaScript execution, no cookies, no session state.
- **Timeout**: `browser_timeout_ms` (default: `30000` — 30 seconds). Abort fetch on timeout.
- **Safety**: Only HTTP/HTTPS URLs allowed. No `file://`, `ftp://`, or other protocols. Response body truncated to prevent memory issues.

> **Important boundary**: This is a basic URL fetcher, not an interactive browser. It does not execute JavaScript, handle authentication, or maintain sessions. See Non-Goals §2 for scope.

### 6.3 Approval Flow

When a tool call requires approval:

1. BedrockAdapter emits `ProviderRuntimeEvent` with type `"request"` and `requestType: "approval"`.
2. Event is translated into orchestration domain event `thread.request-added`.
3. UI shows approval dialog with tool name, arguments, and approve/deny buttons.
4. User response flows back via `respondToRequest(threadId, requestId, decision)`.
5. If approved: ToolExecutor executes the tool, result fed back to model.
6. If denied: ToolExecutor returns `{ is_error: true, output: "User denied this tool call" }` to model.

### 6.4 Execution Loop (Pseudocode)

```
function executeTurn(session, userMessage):
  messages = session.history + [{ role: "user", content: userMessage }]
  
  loop:
    response = await ai.generateText({
      model: session.bedrockModel,
      messages: messages,
      tools: TOOL_DEFINITIONS,
      system: buildSystemPrompt(session.projectDir),
      maxSteps: 25,  // prevent infinite tool loops
    })
    
    if response.finishReason == "tool-calls":
      for each toolCall in response.toolCalls:
        if needsApproval(toolCall, session.runtimeMode):
          result = await requestApproval(toolCall)
          if result.denied:
            messages.push(toolResult(toolCall.id, "Denied by user", isError=true))
            continue
        
        result = await executeToolCall(toolCall, session.projectDir)
        messages.push(toolResult(toolCall.id, result.output, result.isError))
        emit streamEvent(toolCall, result)
      
      continue  // let model see tool results
    
    else:  // "stop", "length", "end-turn"
      session.history = messages + [response.assistantMessage]
      persistSession(session)
      break
```

> **Important nuance**: `maxSteps: 25` prevents infinite tool-call loops. If reached, the turn ends with a warning event. This matches Codex's behavior of bounded tool execution.

---

## 7. Event Translation Contract

### 7.1 Mapping Table: AI SDK → ProviderRuntimeEvent

The EventTranslator maps AI SDK streaming events to existing `ProviderRuntimeEvent` types. The UI does not know which provider is active.

| AI SDK Event | ProviderRuntimeEvent method | Fields |
|---|---|---|
| Stream start | `session.started` | sessionId, model, config |
| Text delta | `turn.content-part.stream.delta` | delta text, contentType: "text" |
| Text complete | `turn.content-part.stream.done` | full text, contentType: "text" |
| Tool call start | `turn.item.created` | itemType: "tool_call", name, args |
| Tool call args delta | `turn.content-part.stream.delta` | delta args JSON |
| Tool call complete | `turn.item.completed` | full tool call object |
| Tool result | `turn.item.created` | itemType: "tool_output", result |
| Turn complete | `turn.completed` | turnId, finishReason |
| Error | `error` | code, message, recoverable flag |
| Approval request | `turn.request.created` | requestId, requestType, toolName, args |
| Approval resolved | `turn.request.resolved` | requestId, decision |

> **Important boundary**: The EventTranslator MUST NOT emit provider-specific event types. All events must use existing `ProviderRuntimeEvent` method names. If a Bedrock-specific event has no mapping, it is logged but not emitted.

### 7.2 Streaming Implementation

The BedrockAdapter uses the AI SDK's `streamText()` for streaming responses:

```
function streamTurn(session, messages):
  stream = ai.streamText({
    model: session.bedrockModel,
    messages: messages,
    tools: TOOL_DEFINITIONS,
    system: buildSystemPrompt(session.projectDir),
  })
  
  for await (part of stream.fullStream):
    event = translateToRuntimeEvent(part, session)
    if event != null:
      queue.offer(event)
```

For tool execution turns (which require back-and-forth), use `generateText()` with `maxSteps` instead of `streamText()`:

```
- Pure text responses: streamText() — real-time streaming to UI
- Tool-using responses: generateText({ maxSteps: 25 }) — batched, emit events per step
```

---

## 8. Configuration Specification

### 8.1 Config Cheat Sheet

| Key | Type | Default | Env Override | Description |
|---|---|---|---|---|
| `aws_access_key_id` | `string` | — | `AWS_ACCESS_KEY_ID` | AWS access key |
| `aws_secret_access_key` | `string` | — | `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `aws_region` | `string` | `"us-east-1"` | `AWS_REGION` | AWS region for Bedrock |
| `aws_session_token` | `string \| null` | `null` | `AWS_SESSION_TOKEN` | Temp session token |
| `aws_profile` | `string \| null` | `null` | `AWS_PROFILE` | Named AWS profile |
| `bedrock_default_model` | `string` | `"anthropic.claude-sonnet-4-20250514-v1:0"` | `BEDROCK_DEFAULT_MODEL` | Default model ID |
| `shell_timeout_ms` | `integer` | `120000` | — | Shell command timeout |
| `max_tool_steps` | `integer` | `25` | — | Max tool-call loop iterations |
| `max_context_tokens` | `integer` | `190000` | — | Max tokens in conversation context |
| `session_persist_dir` | `string` | `"{stateDir}/bedrock-sessions"` | — | Session persistence directory |

### 8.2 Credential Resolution Chain

Resolution order (first match wins):

1. Env var: `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION`
2. Env var: `AWS_PROFILE` → load from `~/.aws/credentials`
3. AWS SDK default credential chain (`fromNodeProviderChain()`) — covers IAM roles, EC2 instance profiles, ECS task roles, web identity tokens
4. Config file at `{stateDir}/provider-config.json` → `bedrock.accessKeyId` etc.

> **Important nuance**: If NO credentials are found, the Bedrock provider is simply not available. The `ProviderHealth` probe marks it as `unavailable` and the model picker hides Bedrock models. No error is thrown at startup.

---

## 9. Session Lifecycle & State Machine

### 9.1 States

```
[not_started] → [starting] → [active] → [turn_in_progress] → [active]
                                   ↓              ↓
                              [stopping]    [awaiting_approval]
                                   ↓              ↓
                              [stopped]    [turn_in_progress]
                                                   ↓
                                              [active]
```

| State | Description | Valid Transitions |
|---|---|---|
| `not_started` | Session object created but not initialized | → `starting` |
| `starting` | Validating credentials, creating AI SDK client | → `active`, → `stopped` (on failure) |
| `active` | Ready for user input | → `turn_in_progress`, → `stopping` |
| `turn_in_progress` | Model is generating / tools are executing | → `active` (turn complete), → `awaiting_approval`, → `active` (interrupted) |
| `awaiting_approval` | Blocked on user approval for a tool call | → `turn_in_progress` (approved/denied) |
| `stopping` | Cleaning up session resources | → `stopped` |
| `stopped` | Session terminated, no further operations | terminal state |

### 9.2 Session Persistence

Each Bedrock session is persisted to disk at:

```
{stateDir}/bedrock-sessions/{threadId}.json
```

**Persisted on every turn completion.** Schema:

```
{
  "threadId": string,
  "model": string,           // Bedrock model ID
  "created": number,         // Unix timestamp ms
  "updated": number,         // Unix timestamp ms
  "messages": Message[],     // Full conversation history
  "turnCount": number,
  "projectDir": string,
  "runtimeMode": RuntimeMode,
  "state": SessionState
}
```

**On server restart**: `listSessions()` scans `session_persist_dir`, deserializes each file, and returns sessions with `state: "active"` (or the last known state). The AI SDK client is re-created lazily on the next `sendTurn`.

> **Important boundary**: Messages include tool calls and tool results. The full history is replayed to the model on resume. If history exceeds `max_context_tokens`, the oldest messages are summarized or truncated (keep system prompt + last N messages that fit).

---

## 10. System Prompt Assembly

The `SystemPromptBuilder` generates a system prompt for Bedrock sessions that provides workspace context equivalent to what Codex gets natively.

### 10.1 Template

```
You are an expert software engineer working in the project at: {projectDir}

## Project Context
{projectName} — {packageJsonDescription}

## File Structure (top-level)
{fileTreeTopLevel}

## Git Status
Branch: {gitBranch}
Status: {gitStatusSummary}

## Key Files
{readmeContentTruncated}

## Available Tools
You have access to these tools for modifying the project:
- file_read: Read file contents
- file_write: Create or overwrite files  
- file_edit: Apply search/replace edits to files
- shell: Execute terminal commands
- browser: Fetch and read web pages

## Rules
- Always read a file before editing it
- Make minimal, targeted edits
- Explain what you're doing before using tools
- If a shell command might be destructive, explain why it's needed
```

### 10.2 Context Refresh

The file tree and git status are refreshed:
- At session start
- Every 5 turns (configurable via `context_refresh_interval`, default: `5`)
- Never mid-turn (stale context is acceptable during a turn)

---

## 11. Logging, Status, and Observability

### 11.1 Log Events

All log entries use the existing `ServerLogger` at appropriate levels:

| Event | Level | Fields |
|---|---|---|
| Bedrock session started | `info` | threadId, model, region |
| Bedrock turn started | `info` | threadId, turnId, messageLength |
| Tool call requested | `info` | threadId, toolName, argsPreview (truncated 200 chars) |
| Tool call executed | `info` | threadId, toolName, durationMs, exitCode (for shell) |
| Tool call denied | `warn` | threadId, toolName |
| Bedrock API error | `error` | threadId, errorCode, message, retryable |
| Session persisted | `debug` | threadId, messageCount, fileSizeBytes |
| Credential resolution | `debug` | method (env/profile/chain/config), region |
| Context tokens exceeded | `warn` | threadId, tokenCount, maxTokens, truncatedMessages |

### 11.2 Provider Health

The `ProviderHealth` service is extended:

```
For "bedrock":
  1. Check credential resolution (can we build an AWS client?)
  2. If yes, call bedrock:ListFoundationModels with limit=1 as a probe
  3. If probe succeeds: status = "available", include region + account info
  4. If probe fails: status = "unavailable", include error message
  5. If no credentials: status = "not_configured"
```

Health is checked at server startup and exposed via the existing health endpoint.

---

## 12. Failure Model and Recovery Strategy

| Failure | Category | Detection | Recovery |
|---|---|---|---|
| AWS credentials missing | `credentials_missing` | Credential chain returns empty | Mark provider `not_configured`. Hide from model picker. No error. |
| AWS credentials invalid (403) | `credentials_invalid` | Bedrock API returns 403 | Emit error event to UI: "AWS credentials are invalid. Check your access key and permissions." Mark provider `unavailable`. |
| Model not enabled in region | `model_not_available` | Bedrock returns `AccessDeniedException` for model | Emit error: "Model {id} is not enabled in region {region}. Enable it in the AWS Bedrock console." |
| Bedrock rate limit (429) | `rate_limited` | HTTP 429 or `ThrottlingException` | Retry with exponential backoff: delays `[1s, 2s, 4s]`, max 3 retries. If exhausted, emit error event. |
| Bedrock service error (5xx) | `service_error` | HTTP 5xx | Retry with backoff: delays `[2s, 4s, 8s]`, max 3 retries. If exhausted, emit error. |
| Tool execution fails | `tool_error` | Exception in ToolExecutor | Return `{ is_error: true, output: errorMessage }` to model. Model can retry or explain. |
| Shell command timeout | `shell_timeout` | Process exceeds `shell_timeout_ms` | Kill process. Return `{ is_error: true, output: "Command timed out after {timeout}ms" }`. |
| Session file corrupt | `session_corrupt` | JSON parse error on load | Log warning. Delete corrupt file. Session treated as new. |
| Context window overflow | `context_overflow` | Token count exceeds `max_context_tokens` | Truncate oldest non-system messages until within budget. Log warning. |
| Network disconnection | `network_error` | AI SDK throws connection error | Emit error event. User can retry the turn. Session state preserved at last successful turn. |
| Path traversal attempt | `sandbox_violation` | Resolved path outside `projectDir` | Return `{ is_error: true, output: "Access denied: path outside project directory" }`. Log `warn`. |

---

## 13. Security and Operational Safety

### 13.1 Directory Sandbox

All file operations MUST be sandboxed to the project directory:

```
function validatePath(relativePath, projectDir):
  resolved = path.resolve(projectDir, relativePath)
  canonical = fs.realpathSync.native(resolved)  // resolve symlinks
  if not canonical.startsWith(projectDir):
    throw SandboxViolation(relativePath)
  return canonical
```

> **Important nuance**: Symlinks are resolved before the check. A symlink inside the project that points outside is rejected.

### 13.2 Shell Command Safety

- Working directory is always locked to `projectDir`.
- In `approval-required` mode, every command requires user approval.
- In `auto-approve` mode, commands are checked against an allowlist (configurable patterns like `["npm *", "bun *", "git *", "ls *"]`).
- Commands are executed via `child_process.spawn` with `shell: true`, inheriting only safe env vars.
- Process is killed after `shell_timeout_ms`.

### 13.3 Credential Safety

- AWS credentials are NEVER logged (even at debug level).
- AWS credentials are NEVER sent to the Bedrock model in the system prompt or messages.
- Credentials in config file are stored as plaintext (same as `~/.aws/credentials` convention). Encryption is a future enhancement.
- `AWS_SESSION_TOKEN` is supported for temporary credentials (STS, SSO).

### 13.4 Invariants

1. A Bedrock session MUST NOT execute tool calls without going through the approval flow (based on runtime mode).
2. The ToolExecutor MUST NOT write files outside the project directory under any circumstances.
3. The EventTranslator MUST NOT emit events with a `method` name that doesn't exist in the current `ProviderRuntimeEvent` union.
4. Session persistence MUST be atomic (write to temp file, then rename) to prevent corruption on crash.

---

## 14. Web UI Changes

### 14.1 Model Picker

The model picker currently shows only Codex/OpenAI models. Changes:

1. Query available providers from server health endpoint.
2. Group models by provider: "OpenAI (Codex)" section and "Amazon Bedrock" section.
3. Only show provider sections where health status is `"available"` or `"not_configured"` (for setup prompts).
4. Each model entry shows: display name, model ID, capabilities badges.

### 14.2 Settings Panel

Add a "Providers" section to settings:

- **Amazon Bedrock** subsection:
  - AWS Access Key ID (text input, masked)
  - AWS Secret Access Key (password input)
  - AWS Region (dropdown: us-east-1, us-west-2, eu-west-1, ap-northeast-1, etc.)
  - Session Token (optional, text input)
  - "Test Connection" button → calls health probe
  - Status indicator: ✅ Connected / ❌ Invalid / ⚪ Not configured

### 14.3 Session Creation

When creating a new session (thread):
- `thread.create` command includes `provider: ProviderKind` field.
- `thread.turn.start` includes `provider: ProviderKind` + `model: string` (Bedrock model ID format).
- OrchestrationEngine stores provider kind per thread (persisted in event store).

---

## 15. Reference Algorithms

### 15.1 Context Truncation

```
function truncateContext(messages, maxTokens, systemPrompt):
  // System prompt is always included
  budget = maxTokens - countTokens(systemPrompt)
  
  // Always keep the last user message + any pending tool results
  required = messages.filter(m => m == lastUserMessage || m.isPendingToolResult)
  budget -= countTokens(required)
  
  // Fill remaining budget from most recent to oldest
  optional = messages.filter(m => m not in required).reverse()
  kept = []
  for msg in optional:
    tokens = countTokens(msg)
    if budget - tokens >= 0:
      kept.unshift(msg)
      budget -= tokens
    else:
      break
  
  return [systemPrompt, ...kept, ...required]
```

> Token counting uses a rough estimate: `ceil(text.length / 4)`. Precise counting is not required — a 10% buffer is acceptable.

### 15.2 Atomic Session Persistence

```
function persistSession(session):
  data = JSON.stringify(session, null, 2)
  tmpPath = session.filePath + ".tmp"
  writeFileSync(tmpPath, data)
  renameSync(tmpPath, session.filePath)  // atomic on POSIX
```

---

## 16. Implementation Checklist (Definition of Done)

See [TEST_MATRIX.md](./TEST_MATRIX.md) for the complete test matrix and validation profiles.

### Core Conformance (Must-Pass)

- [ ] `ProviderKind` expanded to `"codex" | "bedrock"` in contracts
- [ ] Bedrock model catalog defined with at least: Opus 4.5, Sonnet 4.5, Sonnet 4, Haiku 4.5
- [ ] `BedrockAdapter` implements full `ProviderAdapter` interface
- [ ] `ToolExecutor` implements `file_read`, `file_write`, `file_edit`, `shell`, `browser`
- [ ] Directory sandbox enforced on all file operations
- [ ] All 3 approval modes work: `approval-required`, `full-auto`, `auto-approve`
- [ ] EventTranslator maps all AI SDK events to existing `ProviderRuntimeEvent` types
- [ ] Session persistence: create, save after turn, load on restart, resume conversation
- [ ] Credential resolution chain: env vars → AWS profile → SDK chain → config file
- [ ] System prompt includes project context (file tree, git status)
- [ ] Provider health probe runs at startup
- [ ] Model picker shows models from available providers
- [ ] Shell command timeout enforced
- [ ] Context truncation when history exceeds token limit
- [ ] `bun lint` passes
- [ ] `bun typecheck` passes

### Extension Conformance (If-You-Ship-It-Test-It)

- [ ] Settings UI for AWS credential input
- [ ] "Test Connection" button in settings
- [ ] Model capability badges in picker
- [ ] Reasoning effort parameter pass-through for supported models
- [ ] Cross-region model ID support (e.g., `us.anthropic.claude-opus-4-5-20251101-v1:0`)
- [ ] Session model switch via "restart session" flow

### Integration Profile (Requires Real AWS Credentials)

- [ ] End-to-end: create session → send turn → receive streaming response
- [ ] End-to-end: tool call → approval → execution → result back to model
- [ ] End-to-end: server restart → session resume → continue conversation
- [ ] Bedrock rate limit handling (429 → retry → success)
- [ ] Invalid credentials → clear error message in UI
