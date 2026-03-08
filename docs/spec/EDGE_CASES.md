# Edge Case Encyclopedia — Multi-Provider Bedrock Integration

> Companion to [BLUEPRINT.md](./BLUEPRINT.md). Every "what if" scenario organized by subsystem.

---

## 1. Credential Resolution

| # | Scenario | Behavior |
|---|---|---|
| CR1 | Env vars set but access key is empty string | Skip env var step, proceed to profile/chain |
| CR2 | Both env vars AND config file have credentials | Env vars win (resolution order) |
| CR3 | AWS_PROFILE set but profile doesn't exist in `~/.aws/credentials` | Skip profile step, proceed to chain |
| CR4 | `~/.aws/credentials` file doesn't exist | Skip profile step, proceed to chain |
| CR5 | `fromNodeProviderChain()` throws (no IAM role, not on EC2) | Catch exception, proceed to config file |
| CR6 | Config file exists but has invalid JSON | Log warning, skip config step, return null |
| CR7 | Config file has `bedrock` key but missing `secretAccessKey` | Skip config step (both keys required), return null |
| CR8 | Credentials expire mid-session (STS temporary creds) | AI SDK call fails with 403. Emit `credentials_invalid`. User must restart session. |
| CR9 | AWS_SESSION_TOKEN set without access key/secret | Session token ignored — incomplete credential set |
| CR10 | Region env var is empty string | Use default `"us-east-1"` |

---

## 2. Session Lifecycle

| # | Scenario | Behavior |
|---|---|---|
| SL1 | `sendTurn` called on session in `stopped` state | Reject with error: "Session has been stopped" |
| SL2 | `sendTurn` called on session in `turn_in_progress` state | Reject with error: "Turn already in progress" |
| SL3 | `sendTurn` called on session in `awaiting_approval` state | Reject with error: "Session is waiting for approval" |
| SL4 | `interruptTurn` called when no turn in progress | No-op. Log debug: "No turn to interrupt" |
| SL5 | `stopSession` called on already stopped session | No-op. |
| SL6 | `respondToRequest` with unknown requestId | Log warning, ignore. Return error to caller. |
| SL7 | `respondToRequest` after turn was interrupted | Request is stale. Log warning, ignore. |
| SL8 | Server crash mid-write to session file | Temp file exists but rename didn't happen. On restart: temp file ignored, last good version used. |
| SL9 | Two sessions for same threadId | Should not happen — threadId uniqueness enforced. If found on disk scan: keep most recent (by `updated` timestamp), delete other. |
| SL10 | Session file has future `updated` timestamp (clock skew) | Accept it. Don't validate timestamp ordering. |
| SL11 | `projectDir` in persisted session no longer exists | On `sendTurn`: detect directory missing, emit error "Project directory not found", stop session. |

---

## 3. Tool Execution — File Operations

| # | Scenario | Behavior |
|---|---|---|
| TF1 | `file_read` on binary file | Return raw content as string. May contain garbage characters. No special handling. |
| TF2 | `file_read` on very large file (> 1MB) | Read and return. Truncate to 100000 chars with `[truncated]` suffix. |
| TF3 | `file_write` to path with deeply nested non-existent directories | `mkdirSync(parent, { recursive: true })` creates all intermediates. |
| TF4 | `file_write` to read-only file | Exception caught → return `{ is_error: true, output: "Permission denied: {path}" }` |
| TF5 | `file_edit` where `old_text` appears multiple times | Replace FIRST occurrence only. This matches the tool description. |
| TF6 | `file_edit` where `old_text` is empty string | Return error: "old_text cannot be empty" |
| TF7 | `file_edit` where `new_text` equals `old_text` | Execute normally (no-op edit). Return "Edit applied" — don't check for idempotency. |
| TF8 | `file_write` with empty content | Create/overwrite with empty file. Valid operation. |
| TF9 | Concurrent file operations on same file from different tool calls | Possible if model issues parallel tool calls. No locking — last write wins. |
| TF10 | File path contains special characters (`spaces`, `#`, Unicode) | Handle normally via `path.resolve()`. No special encoding needed. |
| TF11 | Symlink inside project pointing to another file inside project | Allowed — canonical path still within `projectDir`. |

---

## 4. Tool Execution — Shell

| # | Scenario | Behavior |
|---|---|---|
| TS1 | Shell command that starts a background process (`&` at end) | Process spawned. Parent timeout still applies. On timeout, parent killed — background process may survive (OS-level). |
| TS2 | Shell command that reads from stdin | Process hangs (no stdin provided). Killed by timeout. |
| TS3 | Shell command with very long output (> 10000 chars) | Truncate to 10000 chars. Append `"\n[output truncated at 10000 chars]\nExit code: {code}"`. |
| TS4 | Shell command exits immediately with code 0 but empty output | Return `"Exit code: 0"`. |
| TS5 | Shell command exits with non-zero code | Return `"{stdout+stderr}\nExit code: {code}"`. `is_error: false` — non-zero exit is not a tool error, it's information. |
| TS6 | Shell command kills server process (`kill -9 $$`) | Server dies. On restart, session recovers from disk. This is user's responsibility (approval mode should catch this). |
| TS7 | Shell command that changes directory (`cd /tmp && rm -rf *`) | Working dir is locked to `projectDir` for the spawn. `cd` within the command works — this is by design (user approved it). |
| TS8 | Shell command with environment variable references (`echo $HOME`) | Resolved by the shell. Safe env vars inherited from server process. |

---

## 5. Tool Execution — Browser

| # | Scenario | Behavior |
|---|---|---|
| TB1 | URL returns non-HTML content (JSON, plain text, XML) | Return raw text content, truncated to 15000 chars. |
| TB2 | URL returns HTTP redirect (301/302) | `fetch()` follows redirects by default (up to 20). Final content returned. |
| TB3 | URL returns 404 | Return `{ is_error: true, output: "HTTP 404 Not Found: {url}" }`. |
| TB4 | URL returns very large page (> 1MB HTML) | Read first 1MB, then truncate extracted text to 15000 chars. |
| TB5 | URL has self-signed SSL certificate | `fetch()` rejects by default. Return error: "SSL certificate error for {url}". |
| TB6 | URL is `localhost` or private IP | Allowed — no IP filtering. (May want to restrict in future.) |
| TB7 | URL is `file:///etc/passwd` | Rejected by URL scheme validation before fetch: "only HTTP and HTTPS allowed". |
| TB8 | URL returns content-type `application/pdf` | Return raw text extraction (will be garbage). Not a useful result but not an error. |
| TB9 | DNS resolution fails | `fetch()` throws → return `{ is_error: true, output: "DNS resolution failed for {url}" }`. |

---

## 6. Event Translation

| # | Scenario | Behavior |
|---|---|---|
| ET1 | AI SDK emits event type not in our mapping | Log at `debug` level. Do NOT emit to event stream. Silently ignore. |
| ET2 | AI SDK emits empty text delta (`""`) | Skip — do not emit empty delta event. |
| ET3 | AI SDK emits tool call with unknown tool name | Emit the `turn.item.created` event. ToolExecutor will return `unknown_tool` error. |
| ET4 | AI SDK stream errors after partial text | Emit `error` event. Partial text already emitted is visible in UI. |
| ET5 | AI SDK finishes with reason `"length"` (output token limit) | Emit `turn.completed` with `finishReason: "length"`. UI may show "Response was truncated". |
| ET6 | Multiple concurrent turns on same session | Rejected — `sendTurn` checks `state == "active"`. Second call gets error. |

---

## 7. Session Persistence

| # | Scenario | Behavior |
|---|---|---|
| SP1 | Disk full during session persist | `writeFileSync` throws. Log error. Session continues in memory but not recoverable on crash. |
| SP2 | Session file modified externally while server running | Server uses in-memory state. External changes ignored until restart. On restart, reads whatever is on disk. |
| SP3 | Session persist dir doesn't exist at startup | Create it: `mkdirSync(dir, { recursive: true })`. |
| SP4 | Session persist dir is not writable | Log error at startup. Bedrock sessions will work but won't survive restart. |
| SP5 | 1000+ session files in persist dir | Scan all. May be slow (~1-2s). Log: "Scanning {count} session files...". |
| SP6 | Session file has extra unknown fields | `JSON.parse` succeeds. Unknown fields ignored (forward compatibility). |
| SP7 | Session file missing `messages` field | Default to `[]`. Log warning. Session starts fresh. |
| SP8 | Messages array contains invalid entries | Skip invalid entries. Log warning per invalid entry. Keep valid ones. |

---

## 8. Provider Health

| # | Scenario | Behavior |
|---|---|---|
| PH1 | Health probe succeeds but model list is empty | Status = `available` (Bedrock is reachable). Model availability is per-model, not per-provider. |
| PH2 | Health probe times out (> 10s) | Status = `unavailable`, error = "Health probe timed out". |
| PH3 | Health probe called during active session | Allowed — health probes are independent of sessions. |
| PH4 | Credentials change after startup (env var updated) | Health probe re-runs when "Test Connection" is clicked. Existing sessions use old credentials. |
| PH5 | Both Codex and Bedrock healthy | Both shown in model picker. User picks per-session. |
| PH6 | Codex unhealthy, Bedrock healthy | Only Bedrock models shown. User can only create Bedrock sessions. |

---

## 9. Model Selection

| # | Scenario | Behavior |
|---|---|---|
| MS1 | User selects model by slug (`claude-opus-4.5`) | Resolve via `normalizeModelSlug("claude-opus-4.5", "bedrock")` → full model ID. |
| MS2 | User selects model by full ID | Use directly (already in correct format). |
| MS3 | User selects model not in catalog | Reject: "Unknown model". |
| MS4 | User selects Codex model for Bedrock session | Reject: model not in Bedrock catalog. Provider mismatch. |
| MS5 | Model exists in catalog but not enabled in user's Bedrock account | Session starts. First API call fails with `model_not_available`. |
| MS6 | Cross-region model ID fails, standard ID works | Fallback automatically. Log warning. Continue with standard ID. |

---

## 10. Approval Flow

| # | Scenario | Behavior |
|---|---|---|
| AF1 | User takes 10+ minutes to respond to approval | No timeout on approval. Deferred stays open. Session stays in `awaiting_approval`. |
| AF2 | Server restarts while awaiting approval | Pending request lost (not persisted). Session restored as `active`. Model will re-request tool if needed on next turn. |
| AF3 | User approves but tool execution fails | Tool error returned to model. Approval was valid — the failure is a separate concern. |
| AF4 | Two approval requests in the same turn | Processed sequentially. Second request waits until first is resolved. |
| AF5 | User approves `file_write` to a path that was created by a previous tool call in the same turn | Allowed. File now exists. Write overwrites it. |
| AF6 | Model requests tool in `full-auto` mode, tool execution throws | Error returned to model (same as approved+failed). No approval dialog shown. |

---

## 11. Context Management

| # | Scenario | Behavior |
|---|---|---|
| CM1 | Single message exceeds `max_context_tokens` | Keep system prompt + that single message. Log warning. Model may still reject if too large. |
| CM2 | System prompt itself exceeds token budget | Use system prompt anyway (it's mandatory). Effective message budget is 0. Only last user message included. |
| CM3 | Tool results are very large (10000 char shell output × 10 calls) | Tool results are part of messages. Subject to same truncation. Oldest tool results removed first. |
| CM4 | Context refresh at turn 5 finds project was deleted | `SystemPromptBuilder` catches directory-not-found. Emit warning. Use stale context from last refresh. |
| CM5 | Token estimation is off by 20% | Acceptable. The 10% buffer + model's own context window provides safety margin. |
