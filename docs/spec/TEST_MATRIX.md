# Test & Validation Matrix — Multi-Provider Bedrock Integration

> Companion to [SPEC.md](./SPEC.md). Maps test cases to spec sections with validation profiles.

---

## Validation Profiles

| Profile | Description | Requirements |
|---|---|---|
| **Core** | Must pass before merge. No real AWS creds needed. | Unit tests, mock AI SDK responses |
| **Extension** | Must pass if the feature is shipped. | UI component tests, settings flow |
| **Integration** | Requires real AWS Bedrock credentials. | End-to-end with live API |

---

## Core Conformance Tests

### C1. ProviderKind Schema (SPEC §4.1)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C1.1 | Parse `"codex"` as ProviderKind | Success | Core |
| C1.2 | Parse `"bedrock"` as ProviderKind | Success | Core |
| C1.3 | Parse `"unknown"` as ProviderKind | Schema validation error | Core |
| C1.4 | `DEFAULT_PROVIDER_KIND` equals `"codex"` | True | Core |

### C2. BedrockAdapter — ProviderAdapter Interface (SPEC §5)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C2.1 | `startSession()` with valid creds + model → returns `ProviderSession` | Session with threadId, model, state | Core |
| C2.2 | `startSession()` with invalid creds → fails with `credentials_invalid` | Error event emitted | Core |
| C2.3 | `sendTurn()` with text message → streams text response events | `turn.content-part.stream.delta` + `turn.completed` | Core |
| C2.4 | `interruptTurn()` while turn in progress → aborts generation | Turn ends, session returns to `active` | Core |
| C2.5 | `stopSession()` → session state becomes `stopped` | No further events | Core |
| C2.6 | `listSessions()` returns all active Bedrock sessions | Array of ProviderSession | Core |
| C2.7 | `hasSession()` for existing threadId → true | True | Core |
| C2.8 | `hasSession()` for unknown threadId → false | False | Core |
| C2.9 | `stopAll()` stops all Bedrock sessions | All sessions in `stopped` state | Core |
| C2.10 | `capabilities.sessionModelSwitch` equals `"restart-session"` | True | Core |

### C3. ToolExecutor (SPEC §6)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C3.1 | `file_read` with valid relative path → returns file contents | File content string | Core |
| C3.2 | `file_read` with nonexistent path → returns error | `{ is_error: true }` | Core |
| C3.3 | `file_read` with `../` escape → sandbox violation | `{ is_error: true, output: "Access denied..." }` | Core |
| C3.4 | `file_write` creates new file in project dir | File exists with correct content | Core |
| C3.5 | `file_write` creates parent directories | Intermediate dirs created | Core |
| C3.6 | `file_write` with path outside project → sandbox violation | Rejected, file not created | Core |
| C3.7 | `file_write` with symlink pointing outside project → rejected | Sandbox violation | Core |
| C3.8 | `file_edit` replaces first occurrence of `old_text` | File updated correctly | Core |
| C3.9 | `file_edit` with `old_text` not found → error | `{ is_error: true }` | Core |
| C3.10 | `shell` executes command in project dir | stdout+stderr returned | Core |
| C3.11 | `shell` command exceeding timeout → killed | `{ is_error: true, output: "...timed out..." }` | Core |
| C3.12 | `shell` output truncated at 10000 chars | Output length <= 10000 | Core |
| C3.13 | `shell` exit code appended to output | Output ends with `\nExit code: N` | Core |

### C4. Approval Flow (SPEC §6.3)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C4.1 | `approval-required` mode: `file_write` → emits approval request | `turn.request.created` event | Core |
| C4.2 | `approval-required` mode: `file_read` → no approval needed | Executes directly | Core |
| C4.3 | `full-auto` mode: `shell` → auto-approved | Executes without request | Core |
| C4.4 | `auto-approve` mode: command matches allowlist → auto-approved | Executes without request | Core |
| C4.5 | `auto-approve` mode: command not in allowlist → emits request | `turn.request.created` event | Core |
| C4.6 | Approval granted → tool executes | Tool result returned to model | Core |
| C4.7 | Approval denied → error returned to model | `{ is_error: true, output: "User denied..." }` | Core |

### C5. Event Translation (SPEC §7)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C5.1 | AI SDK text delta → `turn.content-part.stream.delta` | Correct method + delta text | Core |
| C5.2 | AI SDK text complete → `turn.content-part.stream.done` | Full text content | Core |
| C5.3 | AI SDK tool call → `turn.item.created` with tool_call type | Tool name + args | Core |
| C5.4 | AI SDK tool result → `turn.item.created` with tool_output type | Result content | Core |
| C5.5 | AI SDK finish → `turn.completed` | Turn ID + finish reason | Core |
| C5.6 | AI SDK error → `error` event | Error code + message | Core |
| C5.7 | Unknown AI SDK event type → logged, not emitted | No event in stream | Core |

### C6. Session Persistence (SPEC §9.2)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C6.1 | After turn completion → session file written to disk | JSON file at expected path | Core |
| C6.2 | Session file is valid JSON with all required fields | Parses without error | Core |
| C6.3 | `listSessions()` after fresh server start → loads persisted sessions | Sessions from previous run returned | Core |
| C6.4 | Corrupt session file → deleted, treated as new | Warning logged, file removed | Core |
| C6.5 | Persistence is atomic (temp file + rename) | No partial writes on crash | Core |
| C6.6 | Messages include tool calls and tool results | Full history preserved | Core |

### C7. Credential Resolution (SPEC §8.2)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C7.1 | Env vars set → credentials resolved from env | `method: "env"` | Core |
| C7.2 | AWS_PROFILE set → credentials resolved from profile | `method: "profile"` | Core |
| C7.3 | No credentials anywhere → provider `not_configured` | Health status = `not_configured` | Core |
| C7.4 | Env vars take precedence over config file | Env values used, not config | Core |
| C7.5 | Config file values used when no env vars | Config values used | Core |

### C8. System Prompt (SPEC §10)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C8.1 | System prompt includes project directory path | Path present in prompt | Core |
| C8.2 | System prompt includes file tree (top-level) | File listing present | Core |
| C8.3 | System prompt includes git branch | Branch name present | Core |
| C8.4 | System prompt includes tool descriptions | All 4 tools described | Core |
| C8.5 | Context refreshed every N turns | File tree updated after 5 turns | Core |

### C9. Provider Health (SPEC §11.2)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C9.1 | Valid credentials → health = `available` | Status + region returned | Core |
| C9.2 | Invalid credentials → health = `unavailable` | Error message returned | Core |
| C9.3 | No credentials → health = `not_configured` | No error, just status | Core |

### C10. Failure Recovery (SPEC §12)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C10.1 | Rate limit (429) → retries with backoff | Up to 3 retries, delays [1s, 2s, 4s] | Core |
| C10.2 | Service error (5xx) → retries with backoff | Up to 3 retries, delays [2s, 4s, 8s] | Core |
| C10.3 | Retries exhausted → error event emitted | Error event with details | Core |
| C10.4 | Network error → error event, session preserved | Can retry turn | Core |
| C10.5 | Context overflow → oldest messages truncated | Messages fit within budget | Core |

### C11. Security (SPEC §13)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C11.1 | Path traversal `../../etc/passwd` → rejected | Sandbox violation | Core |
| C11.2 | Symlink to outside project → rejected | Sandbox violation | Core |
| C11.3 | AWS credentials never in log output | Grep logs → no key material | Core |
| C11.4 | AWS credentials never in system prompt | Prompt doesn't contain keys | Core |
| C11.5 | Shell timeout kills process | Process terminated after timeout | Core |

### C12. Model Catalog (DOMAIN_MODEL §3)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C12.1 | Catalog includes Opus 4.5 | Model found by ID | Core |
| C12.2 | Catalog includes Sonnet 4.5 | Model found by ID | Core |
| C12.3 | Catalog includes Sonnet 4 | Model found by ID | Core |
| C12.4 | Catalog includes Haiku 4.5 | Model found by ID | Core |
| C12.5 | `resolveBedrockModelId` adds region prefix for us-east-1 | `us.anthropic.claude-...` | Core |
| C12.6 | Unknown model ID → validation error | Rejected | Core |

### C13. ProviderAdapterRegistry (SPEC §5.3)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C13.1 | Lookup `"codex"` → CodexAdapter | Correct adapter | Core |
| C13.2 | Lookup `"bedrock"` → BedrockAdapter | Correct adapter | Core |
| C13.3 | Lookup unknown kind → error | Clear error message | Core |

### C14. Build Quality (AGENTS.md)

| ID | Test | Expected | Profile |
|---|---|---|---|
| C14.1 | `bun lint` passes | Exit code 0 | Core |
| C14.2 | `bun typecheck` passes | Exit code 0 | Core |

---

## Extension Conformance Tests

### E1. Settings UI

| ID | Test | Expected | Profile |
|---|---|---|---|
| E1.1 | Bedrock settings section visible | AWS credential inputs rendered | Extension |
| E1.2 | Save credentials → writes config file | `provider-config.json` updated | Extension |
| E1.3 | "Test Connection" → calls health probe | Status indicator updates | Extension |
| E1.4 | Region dropdown lists common AWS regions | At least 4 regions shown | Extension |

### E2. Model Picker

| ID | Test | Expected | Profile |
|---|---|---|---|
| E2.1 | Bedrock available → shows Bedrock section | Models grouped under "Amazon Bedrock" | Extension |
| E2.2 | Bedrock not configured → hides Bedrock section | Only Codex models shown | Extension |
| E2.3 | Selecting Bedrock model → creates session with `provider: "bedrock"` | Correct provider in thread.create | Extension |
| E2.4 | Model shows capability badges | Reasoning, vision badges visible | Extension |

### E3. Cross-Region

| ID | Test | Expected | Profile |
|---|---|---|---|
| E3.1 | Region `us-east-1` → prefix `us.` | Model ID starts with `us.` | Extension |
| E3.2 | Region `eu-west-1` → prefix `eu.` | Model ID starts with `eu.` | Extension |
| E3.3 | Prefixed model fails → fallback to standard | Warning logged, standard ID used | Extension |

### E4. Reasoning Effort

| ID | Test | Expected | Profile |
|---|---|---|---|
| E4.1 | Reasoning-capable model + effort param → passed to AI SDK | `reasoningConfig` in request | Extension |
| E4.2 | Non-reasoning model + effort param → ignored | No error, param dropped | Extension |

---

## Integration Tests (Require Real AWS Credentials)

### I1. End-to-End Flows

| ID | Test | Expected | Profile |
|---|---|---|---|
| I1.1 | Create Bedrock session → send "Hello" → receive response | Streaming text events in UI | Integration |
| I1.2 | Send "Create a file hello.txt with content 'Hi'" → tool call → approval → file created | File exists on disk | Integration |
| I1.3 | Send "Run ls -la" → shell tool call → approval → output shown | Directory listing in response | Integration |
| I1.4 | Restart server → list sessions → resume conversation | Previous messages visible | Integration |
| I1.5 | Switch from Codex session to Bedrock session | Both sessions work independently | Integration |

### I2. Error Handling

| ID | Test | Expected | Profile |
|---|---|---|---|
| I2.1 | Invalid AWS key → clear error in UI | "AWS credentials are invalid" message | Integration |
| I2.2 | Model not enabled → clear error | "Model not enabled in region" message | Integration |
| I2.3 | Rate limit hit → retry succeeds | Response eventually arrives | Integration |

---

## Test Count Summary

| Profile | Count |
|---|---|
| Core Conformance | 62 |
| Extension Conformance | 12 |
| Integration | 8 |
| **Total** | **82** |
