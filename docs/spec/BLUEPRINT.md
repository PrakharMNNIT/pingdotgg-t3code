# BLUEPRINT: Multi-Provider Bedrock Integration

> Expands [SPEC.md](./SPEC.md) into exhaustive implementation detail.
> Companion files: [ERROR_CATALOG.md](./ERROR_CATALOG.md) · [EDGE_CASES.md](./EDGE_CASES.md)

---

## 1. Document Header

**Source SPEC**: `docs/spec/SPEC.md` v1.0
**Scope**: Every behavioral detail for implementing Amazon Bedrock as a second provider in T3 Code — from contracts schema changes through server adapter to UI model picker.

---

## 2. Entity Catalog

### 2.1 ProviderKind

**Location**: `packages/contracts/src/orchestration.ts`

**Current code**: `export const ProviderKind = Schema.Literal("codex")`
**New code**: `export const ProviderKind = Schema.Literal("codex", "bedrock")`

| Aspect | Detail |
|---|---|
| Type | `"codex" \| "bedrock"` |
| Default | `"codex"` |
| Validation | Schema.Literal parse — rejects any string not in the union |
| On invalid | Effect Schema `ParseError` with message `'Expected "codex" \| "bedrock", got "X"'` |
| Used in | `ProviderAdapterRegistry` lookup, `ProviderService` routing, `thread.create` command, `thread.turn.start` command, `ProviderHealth` probes, UI model picker grouping, `ProviderSessionDirectory` bindings |

### 2.2 BedrockModel

**Location**: `packages/contracts/src/model.ts`

| Field | Type | Required | Default | Validation | On Invalid | Used In |
|---|---|---|---|---|---|---|
| `id` | `string` | yes | — | Must match pattern `^[a-z0-9.-]+:[0-9]+$` or `^(us\|eu\|ap\|global)\.[a-z0-9.-]+:[0-9]+$` | Reject with `"Invalid Bedrock model ID format: {value}"` | AI SDK `model()` call, session persistence, health probe |
| `slug` | `string` | yes | — | Non-empty, lowercase alphanumeric + dots + hyphens, max 50 chars | Reject with `"Invalid model slug"` | UI model picker display, `/model` command, model resolution |
| `name` | `string` | yes | — | Non-empty, max 100 chars | Reject | UI display name |
| `provider` | `"bedrock"` | yes | `"bedrock"` | Literal `"bedrock"` | Reject | Grouping in UI |
| `capabilities.reasoning` | `boolean` | yes | — | Boolean | Reject | Reasoning effort UI toggle, `reasoningConfig` pass-through |
| `capabilities.tool_use` | `boolean` | yes | — | Boolean | Reject | Tool definition inclusion in API call |
| `capabilities.vision` | `boolean` | yes | — | Boolean | Reject | Image attachment UI toggle |
| `capabilities.streaming` | `boolean` | yes | — | Boolean | Reject | `streamText` vs `generateText` selection |
| `context_window` | `number` | yes | — | Positive integer, >= 1000 | Reject | `max_context_tokens` cap, truncation budget |
| `max_output` | `number` | yes | — | Positive integer, >= 100 | Reject | AI SDK `maxTokens` param |

**Catalog data (hardcoded array)**:

```
[
  { id: "anthropic.claude-opus-4-5-20251101-v1:0", slug: "claude-opus-4.5", name: "Claude Opus 4.5", provider: "bedrock", capabilities: { reasoning: true, tool_use: true, vision: true, streaming: true }, context_window: 200000, max_output: 32000 },
  { id: "anthropic.claude-sonnet-4-5-20250929-v1:0", slug: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "bedrock", capabilities: { reasoning: true, tool_use: true, vision: true, streaming: true }, context_window: 200000, max_output: 16000 },
  { id: "anthropic.claude-sonnet-4-20250514-v1:0", slug: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "bedrock", capabilities: { reasoning: true, tool_use: true, vision: true, streaming: true }, context_window: 200000, max_output: 16000 },
  { id: "anthropic.claude-haiku-4-5-20251001-v1:0", slug: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "bedrock", capabilities: { reasoning: false, tool_use: true, vision: true, streaming: true }, context_window: 200000, max_output: 8192 },
  { id: "anthropic.claude-opus-4-1-20250805-v1:0", slug: "claude-opus-4.1", name: "Claude Opus 4.1", provider: "bedrock", capabilities: { reasoning: true, tool_use: true, vision: true, streaming: true }, context_window: 200000, max_output: 32000 },
]
```

### 2.3 BedrockSession

**Location**: `apps/server/src/provider/Layers/BedrockAdapter.ts` (in-memory) + `{stateDir}/bedrock-sessions/{threadId}.json` (disk)

| Field | Type | Required | Default | Validation | Persisted | On Invalid |
|---|---|---|---|---|---|---|
| `threadId` | `string` | yes | Generated via `crypto.randomUUID()` | UUID format, non-empty | yes | Reject session creation |
| `model` | `string` | yes | `bedrock_default_model` config | Must exist in catalog | yes | Error: `"Unknown model: {value}"` |
| `created` | `number` | yes | `Date.now()` | Positive integer | yes | Reset to `Date.now()` |
| `updated` | `number` | yes | `Date.now()` | >= `created` | yes | Reset to `Date.now()` |
| `messages` | `ConversationMessage[]` | yes | `[]` | Valid array of messages | yes | Log warning, reset to `[]` |
| `turnCount` | `number` | yes | `0` | Non-negative integer | yes | Reset to `0` |
| `projectDir` | `string` | yes | From `ProviderSessionStartInput` | Absolute path, directory must exist | yes | Error: `"Project directory not found: {path}"` |
| `runtimeMode` | `RuntimeMode` | yes | `"approval-required"` | One of 3 values | yes | Fallback to `"approval-required"` |
| `state` | `SessionState` | yes | `"not_started"` | Valid state value | yes | Reset to `"active"` on load |
| `pendingRequests` | `Map<string, PendingRequest>` | no | `new Map()` | — | **no** | Reconstructed as empty |
| `abortController` | `AbortController \| null` | no | `null` | — | **no** | Reconstructed as `null` |

### 2.4 ToolDefinition

**Location**: `apps/server/src/provider/tools/definitions.ts` (new file)

Uses Vercel AI SDK `tool()` helper. Each definition:

```
file_read:
  description: "Read the contents of a file at a given path relative to the project root."
  parameters: z.object({ path: z.string().describe("Relative file path from project root") })

file_write:
  description: "Create or overwrite a file at a given path relative to the project root."
  parameters: z.object({
    path: z.string().describe("Relative file path to create/overwrite"),
    content: z.string().describe("Full file content to write")
  })

file_edit:
  description: "Apply a targeted edit to an existing file. Finds the first occurrence of old_text and replaces it with new_text."
  parameters: z.object({
    path: z.string().describe("Relative file path to edit"),
    old_text: z.string().describe("Exact text to find (first occurrence)"),
    new_text: z.string().describe("Replacement text")
  })

shell:
  description: "Execute a shell command in the project directory."
  parameters: z.object({ command: z.string().describe("Shell command to execute") })

browser:
  description: "Fetch a URL and extract its text content. Useful for reading documentation or web pages."
  parameters: z.object({ url: z.string().url().describe("Absolute HTTP/HTTPS URL to fetch") })
```

---

## 3. Configuration Bible

### 3.1 Full Config Key Specifications

#### `aws_access_key_id`

| Aspect | Detail |
|---|---|
| Type | `string` |
| Default | None (no default — must be provided or absent) |
| Env override | `AWS_ACCESS_KEY_ID` |
| Config path | `bedrock.accessKeyId` in `{stateDir}/provider-config.json` |
| Validation | Non-empty. 16-128 chars. Alphanumeric only. |
| Valid examples | `"AKIAIOSFODNN7EXAMPLE"` |
| Invalid examples | `""` → credential chain skips env. `"short"` (< 16 chars) → warning logged, attempt anyway |
| Dynamic reload | No — resolved once at session start. Change requires new session. |
| Behavioral impact | Used by `CredentialResolver`. If absent + no other cred source → provider `not_configured`. |

#### `aws_secret_access_key`

| Aspect | Detail |
|---|---|
| Type | `string` |
| Default | None |
| Env override | `AWS_SECRET_ACCESS_KEY` |
| Config path | `bedrock.secretAccessKey` |
| Validation | Non-empty. Min 1 char. |
| Dynamic reload | No |
| Behavioral impact | Paired with `aws_access_key_id`. Both must be present for env-var auth. |

#### `aws_region`

| Aspect | Detail |
|---|---|
| Type | `string` |
| Default | `"us-east-1"` |
| Env override | `AWS_REGION` |
| Config path | `bedrock.region` |
| Validation | Pattern `^[a-z]{2}-[a-z]+-\d+$` |
| Valid examples | `"us-east-1"`, `"us-west-2"`, `"eu-west-1"`, `"ap-northeast-1"` |
| Invalid examples | `"US-EAST-1"` → rejected. `"useast1"` → rejected. `""` → use default. |
| Dynamic reload | No |
| Behavioral impact | Passed to `createAmazonBedrock({ region })`. Determines cross-region model ID prefix. Affects model availability. |

#### `aws_session_token`

| Aspect | Detail |
|---|---|
| Type | `string \| null` |
| Default | `null` |
| Env override | `AWS_SESSION_TOKEN` |
| Config path | `bedrock.sessionToken` |
| Validation | If present, non-empty |
| Dynamic reload | No |
| Behavioral impact | If present, passed as third credential for STS temporary credentials. |

#### `aws_profile`

| Aspect | Detail |
|---|---|
| Type | `string \| null` |
| Default | `null` |
| Env override | `AWS_PROFILE` |
| Config path | `bedrock.profile` |
| Validation | If present, non-empty, no whitespace |
| Dynamic reload | No |
| Behavioral impact | If present and no explicit access key, loads credentials from `~/.aws/credentials` named profile. |

#### `bedrock_default_model`

| Aspect | Detail |
|---|---|
| Type | `string` |
| Default | `"anthropic.claude-sonnet-4-20250514-v1:0"` |
| Env override | `BEDROCK_DEFAULT_MODEL` |
| Config path | `bedrock.defaultModel` |
| Validation | Must exist in model catalog |
| Invalid examples | `"gpt-4"` → rejected (not in Bedrock catalog). `""` → use default. |
| Dynamic reload | No |
| Behavioral impact | Used when session starts without explicit model selection. |

#### `shell_timeout_ms`

| Aspect | Detail |
|---|---|
| Type | `integer` |
| Default | `120000` (2 minutes) |
| Validation | Positive integer, >= 1000, <= 600000 |
| Invalid | `0` → use default. `-1` → use default. `999` → use default. `600001` → cap at `600000`. |
| Dynamic reload | No |
| Behavioral impact | `child_process.spawn` timeout. Process killed with SIGTERM then SIGKILL after 5s. |

#### `max_tool_steps`

| Aspect | Detail |
|---|---|
| Type | `integer` |
| Default | `25` |
| Validation | Positive integer, >= 1, <= 100 |
| Invalid | `0` → use default. `101` → cap at `100`. |
| Dynamic reload | No |
| Behavioral impact | AI SDK `maxSteps` param. Prevents infinite tool loops. Turn ends with warning when reached. |

#### `max_context_tokens`

| Aspect | Detail |
|---|---|
| Type | `integer` |
| Default | `190000` |
| Validation | Positive integer, >= 1000 |
| Dynamic reload | No |
| Behavioral impact | Triggers context truncation. Also capped by model's `context_window`. Effective limit = `min(max_context_tokens, model.context_window)`. |

#### `session_persist_dir`

| Aspect | Detail |
|---|---|
| Type | `string` |
| Default | `"{stateDir}/bedrock-sessions"` |
| Validation | Must be writable path. Created if absent. |
| Dynamic reload | No |
| Behavioral impact | Directory scanned on startup for session recovery. Each session is a JSON file here. |

#### `browser_timeout_ms` (addition from SPEC §6.2)

| Aspect | Detail |
|---|---|
| Type | `integer` |
| Default | `30000` (30 seconds) |
| Validation | Positive integer, >= 1000, <= 120000 |
| Dynamic reload | No |
| Behavioral impact | `fetch()` AbortController timeout for browser tool. |

---

## 4. State Transition Matrix

Complete matrix: every (State × Trigger) combination.

| Current State | `start` | `started` | `start_fail` | `send_turn` | `turn_complete` | `approval_needed` | `approval_resolved` | `interrupt` | `stop` |
|---|---|---|---|---|---|---|---|---|---|
| `not_started` | → `starting` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | → `stopped` |
| `starting` | ✗ | → `active` | → `stopped` | ✗ | ✗ | ✗ | ✗ | ✗ | → `stopped` |
| `active` | ✗ | ✗ | ✗ | → `turn_in_progress` | ✗ | ✗ | ✗ | ✗ | → `stopping` |
| `turn_in_progress` | ✗ | ✗ | ✗ | ✗ | → `active` | → `awaiting_approval` | ✗ | → `active` | → `stopping` |
| `awaiting_approval` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | → `turn_in_progress` | → `active` | → `stopping` |
| `stopping` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | → `stopped` |
| `stopped` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (terminal) |

**✗** = Invalid transition. Log warning, ignore trigger.

---

## 5. Sequence Specifications

### 5.1 Session Start

```
1. UI sends `thread.create` with { provider: "bedrock", model: "anthropic.claude-opus-4-5-20251101-v1:0", projectDir, runtimeMode }
2. OrchestrationEngine dispatches to ProviderService
3. ProviderService looks up "bedrock" in ProviderAdapterRegistry → BedrockAdapter
4. BedrockAdapter.startSession():
   4a. Validate model exists in catalog → ERROR if not: "Unknown model"
   4b. Resolve credentials via CredentialResolver
       4b-i.  Check env vars (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION)
       4b-ii. If not: check AWS_PROFILE → load from ~/.aws/credentials
       4b-iii.If not: try fromNodeProviderChain()
       4b-iv. If not: check provider-config.json
       4b-v.  If none found → ERROR "credentials_missing"
   4c. Create AI SDK client: createAmazonBedrock({ region, credentials })
   4d. Apply cross-region model prefix: resolveBedrockModelId(modelId, region)
   4e. Build system prompt via SystemPromptBuilder
   4f. Create BedrockSession object { threadId, model, messages: [], state: "active" }
   4g. Persist session to disk
   4h. Emit event: session.started { sessionId, model, config }
   4i. Return ProviderSession
5. OrchestrationEngine records thread.created event
6. UI receives session confirmation
```

**Error branches:**
- Step 4a fail → `model_not_available` error event, session state → `stopped`
- Step 4b fail → `credentials_missing` error event, session state → `stopped`
- Step 4c fail → `credentials_invalid` error event, session state → `stopped`

### 5.2 Send Turn (with Tool Execution)

```
1. UI sends `thread.turn.start` with { threadId, message, model, provider }
2. BedrockAdapter.sendTurn():
   2a. Validate session exists and state == "active" → ERROR if not
   2b. Set state → "turn_in_progress"
   2c. Generate turnId via crypto.randomUUID()
   2d. Emit: turn.started { turnId }
   2e. Append user message to session.messages
   2f. Call AI SDK:
       - If model supports streaming AND no previous tool calls this turn:
           streamText({ model, messages, tools, system })
       - Else: generateText({ model, messages, tools, system, maxSteps })
   2g. Process response:
       FOR EACH part in response stream:
         - text-delta → emit turn.content-part.stream.delta { delta }
         - text-done → emit turn.content-part.stream.done { text }
         - tool-call → go to Tool Execution sequence (§5.3)
         - finish → emit turn.completed { turnId, finishReason }
   2h. Update session.messages with assistant response + tool results
   2i. Increment session.turnCount
   2j. Check if context refresh needed (turnCount % context_refresh_interval == 0)
   2k. Persist session to disk
   2l. Set state → "active"
3. OrchestrationEngine records turn events
4. UI renders streamed response
```

### 5.3 Tool Execution

```
1. AI SDK response contains tool call: { toolCallId, toolName, args }
2. Emit: turn.item.created { itemType: "tool_call", toolName, args }
3. Check approval:
   3a. Determine if approval needed (see Approval Decision Table §5.4)
   3b. If approval NOT needed → go to step 5
   3c. If approval needed:
       3c-i.   Create PendingRequest { requestId, toolName, toolArgs }
       3c-ii.  Set state → "awaiting_approval"
       3c-iii. Emit: turn.request.created { requestId, requestType: "approval", toolName, args }
       3c-iv.  Await resolution (Deferred promise)
       3c-v.   User responds via respondToRequest(decision)
       3c-vi.  Set state → "turn_in_progress"
       3c-vii. If decision == "deny" → return { is_error: true, output: "User denied this tool call" }
4. (If denied, skip to step 7)
5. Execute tool:
   5a. file_read:  validatePath(args.path) → readFileSync → return content
   5b. file_write: validatePath(args.path) → mkdirSync(parent) → writeFileSync → return "File written: {path}"
   5c. file_edit:  validatePath(args.path) → readFileSync → indexOf(old_text) → if not found: error → replace → writeFileSync
   5d. shell:      spawn(command, { cwd: projectDir, timeout: shell_timeout_ms }) → collect stdout+stderr → truncate 10000 → append exit code
   5e. browser:    validate URL scheme → fetch(url, { signal: AbortSignal.timeout(browser_timeout_ms) }) → extract text → truncate 15000
6. Build ToolResult { tool_call_id, output, is_error, duration_ms }
7. Emit: turn.item.created { itemType: "tool_output", result }
8. Append tool result message to conversation
9. Return result to AI SDK for next model turn
```

### 5.4 Approval Decision Table

| Tool | `approval-required` | `full-auto` | `auto-approve` |
|---|---|---|---|
| `file_read` | **No** approval | **No** approval | **No** approval |
| `file_write` | **Yes** — always ask | **No** — auto-execute | Check allowlist → ask if not matched |
| `file_edit` | **Yes** — always ask | **No** — auto-execute | Check allowlist → ask if not matched |
| `shell` | **Yes** — always ask | **No** — auto-execute | Check allowlist → ask if not matched |
| `browser` | **Yes** — always ask | **No** — auto-execute | **No** — auto-execute (read-only network) |

**Allowlist matching for `auto-approve`**: Pattern is glob-style. For shell: `["npm *", "bun *", "git *", "ls *", "cat *"]`. For file ops: `["src/**", "test/**", "*.md", "*.json"]`. Configurable via future settings.

### 5.5 Session Resume After Server Restart

```
1. Server starts
2. BedrockAdapter constructor / init:
   2a. Scan session_persist_dir for *.json files
   2b. For each file:
       2b-i.   Attempt JSON.parse
       2b-ii.  If parse fails → log warning, delete file, skip
       2b-iii. Validate required fields present
       2b-iv.  Set state to "active" (regardless of persisted state — we were interrupted)
       2b-v.   Reconstruct pendingRequests as empty Map
       2b-vi.  Reconstruct abortController as null
       2b-vii. Add to sessions Map keyed by threadId
   2c. Log: "Restored {count} Bedrock sessions from disk"
3. On first sendTurn for a restored session:
   3a. Lazily re-create AI SDK client (credentials may have changed)
   3b. Rebuild system prompt (project state may have changed)
   3c. Check context token budget — truncate if needed
   3d. Continue normally
```

---

## 6. Credential Resolution Sequence

```
function resolveCredentials():
  // Step 1: Explicit env vars
  if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY both set:
    region = AWS_REGION || "us-east-1"
    token = AWS_SESSION_TOKEN || null
    return { method: "env", accessKeyId, secretAccessKey, region, sessionToken: token }

  // Step 2: AWS profile
  if AWS_PROFILE set:
    creds = loadFromAwsCredentialsFile(AWS_PROFILE)
    if creds found:
      return { method: "profile", ...creds }

  // Step 3: SDK default chain
  try:
    creds = await fromNodeProviderChain()()
    if creds.accessKeyId exists:
      return { method: "chain", ...creds }
  catch: pass  // chain failed, try next

  // Step 4: Config file
  config = readJsonSync("{stateDir}/provider-config.json")
  if config.bedrock?.accessKeyId and config.bedrock?.secretAccessKey:
    return { method: "config", ...config.bedrock }

  // Step 5: Nothing found
  return null
```

---

## 7. Event Translation Field Mapping

Exact field-by-field mapping from AI SDK stream parts to `ProviderRuntimeEvent`:

### 7.1 Text Delta

```
AI SDK input:
  { type: "text-delta", textDelta: "Hello" }

ProviderRuntimeEvent output:
  {
    method: "turn.content-part.stream.delta",
    params: {
      threadId: session.threadId,
      turnId: currentTurnId,
      itemId: currentItemId,
      contentType: "text",
      delta: "Hello"
    }
  }
```

### 7.2 Tool Call

```
AI SDK input:
  { type: "tool-call", toolCallId: "tc_123", toolName: "file_read", args: { path: "src/index.ts" } }

ProviderRuntimeEvent output:
  {
    method: "turn.item.created",
    params: {
      threadId: session.threadId,
      turnId: currentTurnId,
      item: {
        id: "tc_123",
        type: "tool_call",
        name: "file_read",
        arguments: '{"path":"src/index.ts"}',
        status: "in_progress"
      }
    }
  }
```

### 7.3 Tool Result

```
After tool execution:
  {
    method: "turn.item.created",
    params: {
      threadId: session.threadId,
      turnId: currentTurnId,
      item: {
        id: "tr_123",
        type: "tool_output",
        tool_call_id: "tc_123",
        output: "// file contents...",
        is_error: false
      }
    }
  }
```

### 7.4 Turn Complete

```
AI SDK input:
  { type: "finish", finishReason: "stop", usage: { promptTokens: 1000, completionTokens: 200 } }

ProviderRuntimeEvent output:
  {
    method: "turn.completed",
    params: {
      threadId: session.threadId,
      turnId: currentTurnId,
      finishReason: "stop",
      usage: { input: 1000, output: 200 }
    }
  }
```

### 7.5 Error

```
AI SDK error:
  APICallError { statusCode: 429, message: "Rate limit exceeded" }

ProviderRuntimeEvent output:
  {
    method: "error",
    params: {
      threadId: session.threadId,
      code: "rate_limited",
      message: "Bedrock rate limit exceeded. Retrying...",
      recoverable: true
    }
  }
```

---

## 8. Algorithm Detail

### 8.1 Path Validation Decision Table

| Input | projectDir | Resolved Path | Canonical Path | Starts with projectDir? | Result |
|---|---|---|---|---|---|
| `"src/index.ts"` | `/home/user/proj` | `/home/user/proj/src/index.ts` | `/home/user/proj/src/index.ts` | Yes | ✅ Allow |
| `"../secret.txt"` | `/home/user/proj` | `/home/user/secret.txt` | `/home/user/secret.txt` | No | ❌ `sandbox_violation` |
| `"src/../../etc/passwd"` | `/home/user/proj` | `/home/etc/passwd` | `/home/etc/passwd` | No | ❌ `sandbox_violation` |
| `"link-to-outside"` (symlink → `/etc`) | `/home/user/proj` | `/home/user/proj/link-to-outside` | `/etc` | No | ❌ `sandbox_violation` |
| `"deeply/nested/file.ts"` | `/home/user/proj` | `/home/user/proj/deeply/nested/file.ts` | `/home/user/proj/deeply/nested/file.ts` | Yes | ✅ Allow |

### 8.2 Context Truncation Decision Table

| Total tokens | System prompt | Last user msg | Budget remaining | Action |
|---|---|---|---|---|
| 50000 | 2000 | 500 | 187500 | No truncation needed |
| 195000 | 2000 | 500 | -5500 | Remove oldest messages until budget >= 0 |
| 200000+ | 2000 | 500 | -10500 | Remove oldest, keep last user + pending tool results |

**Example walkthrough:**
```
Input: 20 messages totaling 195000 tokens. max_context_tokens = 190000.
System prompt: 2000 tokens. Last user msg: 500 tokens.
Budget = 190000 - 2000 - 500 = 187500

Messages (newest first): msg20(5000), msg19(8000), msg18(12000), ...msg1(10000)
Keep msg20-msg4 = 170000 tokens. msg3 would exceed budget. Stop.
Output: [systemPrompt, msg4, msg5, ..., msg19, msg20, lastUserMsg]
```

### 8.3 Cross-Region Model ID Resolution

| Region | Prefix | Example Input | Example Output |
|---|---|---|---|
| `us-east-1` | `us.` | `anthropic.claude-opus-4-5-20251101-v1:0` | `us.anthropic.claude-opus-4-5-20251101-v1:0` |
| `us-west-2` | `us.` | `anthropic.claude-opus-4-5-20251101-v1:0` | `us.anthropic.claude-opus-4-5-20251101-v1:0` |
| `eu-west-1` | `eu.` | `anthropic.claude-opus-4-5-20251101-v1:0` | `eu.anthropic.claude-opus-4-5-20251101-v1:0` |
| `ap-northeast-1` | `ap.` | `anthropic.claude-opus-4-5-20251101-v1:0` | `ap.anthropic.claude-opus-4-5-20251101-v1:0` |
| `sa-east-1` | (none) | `anthropic.claude-opus-4-5-20251101-v1:0` | `anthropic.claude-opus-4-5-20251101-v1:0` |

**Fallback**: If prefixed model ID returns `AccessDeniedException`, retry with unprefixed ID. Log warning: `"Cross-region model ID failed, falling back to standard ID"`.

---

## 9. Validation Rules Compendium

Quick-reference of every validation in one place.

| Entity.Field | Rule | Valid Example | Invalid Example | On Invalid |
|---|---|---|---|---|
| ProviderKind | `"codex" \| "bedrock"` | `"bedrock"` | `"claude"` | Schema ParseError |
| BedrockModel.id | Pattern `^[a-z0-9.-]+:[0-9]+$` | `"anthropic.claude-opus-4-5-20251101-v1:0"` | `"gpt-4"` | Reject |
| BedrockCredential.region | Pattern `^[a-z]{2}-[a-z]+-\d+$` | `"us-east-1"` | `"US-EAST-1"` | Reject |
| BedrockSession.threadId | UUID format | `"550e8400-e29b-41d4-a716-446655440000"` | `""` | Reject creation |
| BedrockSession.runtimeMode | `"approval-required" \| "full-auto" \| "auto-approve"` | `"full-auto"` | `"yolo"` | Default `"approval-required"` |
| ToolDef browser.url | `z.string().url()`, HTTP/HTTPS only | `"https://docs.example.com"` | `"file:///etc/passwd"` | `{ is_error: true }` |
| Config shell_timeout_ms | Integer, >= 1000, <= 600000 | `120000` | `0` | Use default |
| Config max_tool_steps | Integer, >= 1, <= 100 | `25` | `0` | Use default |
| File path | Must resolve within projectDir | `"src/app.ts"` | `"../../etc/passwd"` | `sandbox_violation` |
| Shell output | Truncated to 10000 chars | (any output) | Output > 10000 chars | Truncate + append `"[truncated]"` |
| Browser output | Truncated to 15000 chars | (any output) | Output > 15000 chars | Truncate + append `"[truncated]"` |

---

## 10. File Structure (New/Modified Files)

```
packages/contracts/src/
  orchestration.ts          — MODIFIED: ProviderKind add "bedrock"
  model.ts                  — MODIFIED: Add BEDROCK_MODELS catalog, MODEL_OPTIONS_BY_PROVIDER.bedrock
  provider.ts               — NEW: BedrockCredential, ProviderCredential union, ProviderConfig schema

packages/shared/src/
  model.ts                  — MODIFIED: Add bedrock model resolution functions

apps/server/src/
  provider/
    Layers/
      BedrockAdapter.ts     — NEW: Full ProviderAdapter implementation (~500-800 lines)
      ProviderAdapterRegistry.ts — MODIFIED: Add "bedrock" → BedrockAdapter
    Services/
      BedrockAdapter.ts     — NEW: Effect service tag
    tools/
      definitions.ts        — NEW: Tool definitions (file_read, file_write, file_edit, shell, browser)
      executor.ts           — NEW: ToolExecutor service (~300 lines)
      sandbox.ts            — NEW: Path validation, sandbox enforcement (~50 lines)
    credential/
      resolver.ts           — NEW: CredentialResolver service (~100 lines)
    session/
      store.ts              — NEW: BedrockSessionStore (persistence) (~150 lines)
    prompt/
      builder.ts            — NEW: SystemPromptBuilder (~100 lines)
    event/
      translator.ts         — NEW: EventTranslator (AI SDK → ProviderRuntimeEvent) (~200 lines)
  provider/Layers/ProviderHealth.ts — MODIFIED: Add bedrock health probe

apps/web/src/
  components/ModelPicker.tsx  — MODIFIED: Multi-provider grouping
  components/Settings.tsx     — MODIFIED: Bedrock credential inputs
```

---

## 11. Implementation Checklist (Expanded)

> **⚡ SKILL LOADING GUIDE**: Before each phase, load the required skills.
> Use `use_skill` with the exact skill name listed below.

### Phase A: Contracts (packages/contracts, packages/shared)

**Load these skills first:**
- `backend-principle-eng-typescript-pro-max` — Principal-level TypeScript patterns
- `clean-code` — T3 Code naming/style (single-word names, const, no destructuring)
- `api-patterns` — Schema design for provider contracts
- `lint-and-validate` — Run after every change

- [ ] A1. Add `"bedrock"` to `ProviderKind` literal in `orchestration.ts`
- [ ] A2. Add `BEDROCK_MODELS` array to `model.ts`
- [ ] A3. Add `MODEL_OPTIONS_BY_PROVIDER.bedrock` and `DEFAULT_MODEL_BY_PROVIDER.bedrock`
- [ ] A4. Add `MODEL_SLUG_ALIASES_BY_PROVIDER.bedrock` (slug → id mapping)
- [ ] A5. Create `provider.ts` with `BedrockCredential` schema
- [ ] A6. Update `packages/shared/src/model.ts` — `getModelOptions("bedrock")`, `resolveModelSlug` for bedrock
- [ ] A7. Run `bun typecheck` — must pass
- [ ] A8. Run `bun lint` — must pass

### Phase B: Server Infrastructure (apps/server new files)

**Load these skills first:**
- `backend-principle-eng-typescript-pro-max` — (keep loaded from Phase A)
- `clean-code` — (keep loaded from Phase A)
- `nodejs-best-practices` — Child process management (shell tool), file I/O patterns
- `security-best-practices` — Sandbox validation, path traversal prevention, credential safety
- `testing-patterns` — Write tests alongside each module

- [ ] B1. Create `tools/definitions.ts` — 5 tool definitions
- [ ] B2. Create `tools/sandbox.ts` — `validatePath()` function
- [ ] B3. Create `tools/executor.ts` — `ToolExecutor` Effect service
- [ ] B4. Create `credential/resolver.ts` — `CredentialResolver` service
- [ ] B5. Create `session/store.ts` — `BedrockSessionStore` (read/write/list/delete)
- [ ] B6. Create `prompt/builder.ts` — `SystemPromptBuilder`
- [ ] B7. Create `event/translator.ts` — `EventTranslator`
- [ ] B8. Run `bun typecheck` + `bun lint`

### Phase C: BedrockAdapter (apps/server core)

**Load these skills first:**
- `backend-principle-eng-typescript-pro-max` — (keep loaded)
- `architecture` — Architectural decisions for Effect service/layer wiring
- `systematic-debugging` — When integration doesn't work as expected

- [ ] C1. Create `Services/BedrockAdapter.ts` — Effect service tag
- [ ] C2. Create `Layers/BedrockAdapter.ts` — full implementation
- [ ] C3. Wire: startSession, sendTurn, interruptTurn, readThread, rollbackThread
- [ ] C4. Wire: respondToRequest, respondToUserInput, stopSession
- [ ] C5. Wire: listSessions, hasSession, stopAll, streamEvents
- [ ] C6. Modify `ProviderAdapterRegistry` — register `"bedrock"` adapter
- [ ] C7. Modify `ProviderHealth` — add bedrock probe
- [ ] C8. Run `bun typecheck` + `bun lint`

### Phase D: Tests

**Load these skills first:**
- `tdd-workflow` — RED-GREEN-REFACTOR cycle
- `testing-patterns` — Unit test patterns, no mocks per AGENTS.md
- `test-scenarios` — Generate comprehensive test cases from TEST_MATRIX.md

- [ ] D1. Test: ProviderKind schema parses "codex" and "bedrock"
- [ ] D2. Test: ToolExecutor file_read/write/edit with sandbox
- [ ] D3. Test: ToolExecutor shell with timeout
- [ ] D4. Test: Approval flow all 3 modes
- [ ] D5. Test: EventTranslator all event types
- [ ] D6. Test: Session persistence write + read + corrupt handling
- [ ] D7. Test: Credential resolution chain order
- [ ] D8. Test: Path validation sandbox (traversal, symlinks)
- [ ] D9. Run `bun run test` — must pass

### Phase E: UI

**Load these skills first:**
- `nextjs-react-expert` — React component patterns and performance
- `shadcn-ui` — Component library (T3 Code uses shadcn/ui)
- `tailwind-patterns` — Tailwind CSS v4 styling
- `code-review-expert` — Final review before PR
- `requesting-code-review` — Pre-merge verification

- [ ] E1. Model picker: group by provider
- [ ] E2. Model picker: show Bedrock models when available
- [ ] E3. Settings: Bedrock credential inputs
- [ ] E4. Settings: Test Connection button
- [ ] E5. Run `bun typecheck` + `bun lint`

---

## 12. Cross-Reference Index

| Entity / Key | Referenced In Sections |
|---|---|
| `ProviderKind` | §2.1, §4, §5.1, §5.2, §5.3, §5.4, §5.5, §10, §11 |
| `BedrockModel` | §2.2, §3.6, §5.1, §5.2, §8.3, §9, §10 |
| `BedrockSession` | §2.3, §4, §5.1, §5.2, §5.3, §5.5, §8.2 |
| `ToolDefinition` | §2.4, §5.2, §5.3, §5.4, §7 |
| `aws_region` | §3.3, §5.1, §6, §8.3 |
| `shell_timeout_ms` | §3.7, §5.3 |
| `max_tool_steps` | §3.8, §5.2 |
| `max_context_tokens` | §3.9, §5.2, §8.2 |
| Sandbox (`validatePath`) | §5.3, §8.1, §9 |
| Approval flow | §5.3, §5.4 |
| Event translation | §5.2, §7 |
| Session persistence | §2.3, §5.1, §5.2, §5.5 |
| Credential resolution | §3.1-3.5, §5.1, §6 |
