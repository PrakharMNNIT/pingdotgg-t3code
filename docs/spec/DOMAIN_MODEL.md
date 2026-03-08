# Domain Model — Multi-Provider Bedrock Integration

> Companion to [SPEC.md](./SPEC.md). Complete entity definitions with types, defaults, validation.

---

## 1. ProviderKind

```
type ProviderKind = "codex" | "bedrock"
```

| Field | Type | Default | Validation |
|---|---|---|---|
| value | `"codex" \| "bedrock"` | `"codex"` | Must be one of the literal values. Unknown values rejected at schema parse time. |

**Schema location**: `packages/contracts/src/orchestration.ts`

**Change**: `Schema.Literal("codex")` → `Schema.Literal("codex", "bedrock")`

---

## 2. ProviderCredential

Per-provider credential bag. Discriminated union on `provider` field.

### 2.1 CodexCredential

```
{
  provider: "codex"
  // No explicit credentials — Codex reads from its own auth (codex login)
}
```

### 2.2 BedrockCredential

```
{
  provider: "bedrock",
  accessKeyId: string,          // AWS access key ID
  secretAccessKey: string,      // AWS secret access key
  region: string,               // AWS region (e.g., "us-east-1")
  sessionToken: string | null,  // Optional STS session token
  profile: string | null        // Optional AWS profile name
}
```

| Field | Type | Default | Validation |
|---|---|---|---|
| `provider` | `"bedrock"` | — | Literal discriminator |
| `accessKeyId` | `string` | — | Non-empty, 16-128 chars, alphanumeric |
| `secretAccessKey` | `string` | — | Non-empty, min 1 char |
| `region` | `string` | `"us-east-1"` | Must match pattern `^[a-z]{2}-[a-z]+-\d+$` |
| `sessionToken` | `string \| null` | `null` | If present, non-empty |
| `profile` | `string \| null` | `null` | If present, non-empty, no whitespace |

**Schema location**: `packages/contracts/src/provider.ts` (new file)

---

## 3. BedrockModel

Model metadata for Bedrock foundation models.

```
{
  id: string,              // Bedrock model ID: "anthropic.claude-opus-4-5-20251101-v1:0"
  slug: string,            // Display slug: "claude-opus-4.5"
  name: string,            // Human name: "Claude Opus 4.5"
  provider: "bedrock",
  capabilities: {
    reasoning: boolean,    // Extended thinking support
    tool_use: boolean,     // Tool/function calling
    vision: boolean,       // Image input
    streaming: boolean     // Streaming responses
  },
  context_window: number,  // Max context tokens
  max_output: number       // Max output tokens
}
```

### 3.1 Initial Model Catalog

| id | slug | name | reasoning | tool_use | vision | context_window | max_output |
|---|---|---|---|---|---|---|---|
| `anthropic.claude-opus-4-5-20251101-v1:0` | `claude-opus-4.5` | Claude Opus 4.5 | `true` | `true` | `true` | `200000` | `32000` |
| `anthropic.claude-sonnet-4-5-20250929-v1:0` | `claude-sonnet-4.5` | Claude Sonnet 4.5 | `true` | `true` | `true` | `200000` | `16000` |
| `anthropic.claude-sonnet-4-20250514-v1:0` | `claude-sonnet-4` | Claude Sonnet 4 | `true` | `true` | `true` | `200000` | `16000` |
| `anthropic.claude-haiku-4-5-20251001-v1:0` | `claude-haiku-4.5` | Claude Haiku 4.5 | `false` | `true` | `true` | `200000` | `8192` |
| `anthropic.claude-opus-4-1-20250805-v1:0` | `claude-opus-4.1` | Claude Opus 4.1 | `true` | `true` | `true` | `200000` | `32000` |

> **Important boundary**: This catalog is the initial set. Adding models is a code change (update the catalog array in contracts). No dynamic model discovery from Bedrock API in v1 — the catalog is static.

**Schema location**: `packages/contracts/src/model.ts` (extend existing)

### 3.2 Cross-Region Model IDs

Bedrock supports cross-region inference with prefixed model IDs:

```
Standard:     anthropic.claude-opus-4-5-20251101-v1:0
Cross-region: us.anthropic.claude-opus-4-5-20251101-v1:0
Global:       global.anthropic.claude-opus-4-5-20251101-v1:0
```

The model catalog stores the standard ID. Cross-region prefix is applied at runtime based on `aws_region` config:

```
function resolveBedrockModelId(modelId, region):
  if region.startsWith("us-"):
    return "us." + modelId
  if region.startsWith("eu-"):
    return "eu." + modelId
  if region.startsWith("ap-"):
    return "ap." + modelId
  return modelId  // fallback: no prefix
```

> **Important nuance**: Not all models support cross-region inference. If the prefixed ID fails, fall back to the standard ID and log a warning.

---

## 4. BedrockSession

In-memory session state persisted to disk.

```
{
  threadId: string,              // UUID, matches orchestration ThreadId
  model: string,                 // Bedrock model ID
  created: number,               // Unix timestamp ms
  updated: number,               // Unix timestamp ms
  messages: ConversationMessage[],
  turnCount: number,
  projectDir: string,            // Absolute path to project
  runtimeMode: RuntimeMode,      // "approval-required" | "full-auto" | "auto-approve"
  state: SessionState,
  pendingRequests: Map<string, PendingRequest>,
  abortController: AbortController | null  // Not persisted
}
```

| Field | Type | Default | Validation |
|---|---|---|---|
| `threadId` | `string` | Generated UUID | Non-empty, unique across sessions |
| `model` | `string` | `bedrock_default_model` config | Must exist in model catalog |
| `created` | `number` | `Date.now()` | Positive integer |
| `updated` | `number` | `Date.now()` | >= `created` |
| `messages` | `ConversationMessage[]` | `[]` | Valid message array |
| `turnCount` | `number` | `0` | Non-negative integer |
| `projectDir` | `string` | From session start input | Must be absolute path, must exist |
| `runtimeMode` | `RuntimeMode` | `"approval-required"` | One of the 3 valid modes |
| `state` | `SessionState` | `"not_started"` | Valid state per state machine |

**Persistence path**: `{stateDir}/bedrock-sessions/{threadId}.json`

**Not persisted** (reconstructed on load): `pendingRequests`, `abortController`

---

## 5. ConversationMessage

Messages in the conversation history. Union type matching AI SDK message format.

### 5.1 SystemMessage

```
{ role: "system", content: string }
```

### 5.2 UserMessage

```
{ role: "user", content: string | ContentPart[] }
```

### 5.3 AssistantMessage

```
{
  role: "assistant",
  content: string | ContentPart[],
  tool_calls?: ToolCallPart[]  // Present when model requests tools
}
```

### 5.4 ToolResultMessage

```
{
  role: "tool",
  tool_call_id: string,    // References the tool_call ID
  content: string,          // Tool output
  is_error: boolean         // Whether execution failed
}
```

| Field (all variants) | Type | Validation |
|---|---|---|
| `role` | `"system" \| "user" \| "assistant" \| "tool"` | Must be valid role |
| `content` | `string \| ContentPart[]` | Non-null |
| `tool_calls` | `ToolCallPart[] \| undefined` | If present, non-empty array |
| `tool_call_id` | `string` | If role is "tool", required, non-empty |
| `is_error` | `boolean` | If role is "tool", required |

---

## 6. ToolDefinition

Schema for tools exposed to Bedrock models. Follows AI SDK `tool()` format.

```
{
  name: string,            // "file_read" | "file_write" | "file_edit" | "shell"
  description: string,
  parameters: ZodSchema    // JSON Schema for tool input
}
```

### 6.1 file_read Parameters

```
{
  path: z.string().describe("Relative file path from project root")
}
```

### 6.2 file_write Parameters

```
{
  path: z.string().describe("Relative file path to create/overwrite"),
  content: z.string().describe("Full file content to write")
}
```

### 6.3 file_edit Parameters

```
{
  path: z.string().describe("Relative file path to edit"),
  old_text: z.string().describe("Exact text to find (first occurrence)"),
  new_text: z.string().describe("Replacement text")
}
```

### 6.4 shell Parameters

```
{
  command: z.string().describe("Shell command to execute in project directory")
}
```

---

## 7. ToolResult

Result of a tool execution returned to the model.

```
{
  tool_call_id: string,   // References the tool call
  output: string,         // Execution output (stdout, file contents, etc.)
  is_error: boolean,      // True if execution failed
  duration_ms: number     // Execution time
}
```

| Field | Type | Validation |
|---|---|---|
| `tool_call_id` | `string` | Non-empty, must match a pending tool call |
| `output` | `string` | Truncated to 10000 chars for shell output |
| `is_error` | `boolean` | Required |
| `duration_ms` | `number` | Non-negative |

---

## 8. PendingRequest

When a tool call needs user approval, it becomes a PendingRequest.

```
{
  requestId: string,         // UUID
  threadId: string,
  turnId: string,
  toolName: string,          // "file_write" | "file_edit" | "shell"
  toolArgs: Record<string, unknown>,
  created: number,           // Unix timestamp ms
  resolver: Deferred<ApprovalDecision>  // Not persisted
}
```

| Field | Type | Validation |
|---|---|---|
| `requestId` | `string` | UUID format |
| `toolName` | `string` | Must be a known tool name |
| `toolArgs` | `Record<string, unknown>` | Valid JSON |
| `created` | `number` | Positive integer |

**ApprovalDecision**: `"approve" | "deny"`

---

## 9. SessionState

```
type SessionState =
  | "not_started"
  | "starting"
  | "active"
  | "turn_in_progress"
  | "awaiting_approval"
  | "stopping"
  | "stopped"
```

See SPEC.md §9.1 for the complete state machine diagram.

---

## 10. ProviderHealthStatus

```
{
  provider: ProviderKind,
  status: "available" | "unavailable" | "not_configured",
  region?: string,         // For bedrock: AWS region
  error?: string,          // If unavailable: error message
  models?: BedrockModel[], // If available: list of supported models
  checked: number          // Unix timestamp ms of last check
}
```

| Field | Type | Default | Validation |
|---|---|---|---|
| `provider` | `ProviderKind` | — | Required |
| `status` | `string` | — | One of 3 values |
| `region` | `string \| undefined` | — | Present for bedrock if configured |
| `error` | `string \| undefined` | — | Present if `status == "unavailable"` |
| `models` | `BedrockModel[] \| undefined` | — | Present if `status == "available"` |
| `checked` | `number` | `Date.now()` | Positive integer |

---

## 11. ProviderConfig (Persisted)

Config file at `{stateDir}/provider-config.json`:

```
{
  bedrock?: {
    accessKeyId?: string,
    secretAccessKey?: string,
    region?: string,
    sessionToken?: string,
    profile?: string,
    defaultModel?: string
  }
}
```

> **Important boundary**: This file stores user-configured credentials. Env vars take precedence over config file values. The file is created only when the user saves settings via the UI.

---

## 12. Relationships

```
ProviderKind ←──── 1:N ──── BedrockModel (catalog)
ProviderKind ←──── 1:1 ──── ProviderAdapter (registry)
ProviderKind ←──── 1:1 ──── ProviderHealthStatus
BedrockSession ──── 1:1 ──── ThreadId (orchestration)
BedrockSession ──── 1:N ──── ConversationMessage
BedrockSession ──── 0:N ──── PendingRequest (in-flight approvals)
ToolDefinition ──── 1:N ──── ToolResult (per turn)
```
