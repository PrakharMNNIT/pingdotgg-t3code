# Error Catalog — Multi-Provider Bedrock Integration

> Companion to [BLUEPRINT.md](./BLUEPRINT.md). Every error fully specified.

---

## Error Entry Format

Each error has: **Code**, **Message Template**, **Trigger**, **Recovery**, **Blast Radius**, **Operator Visibility**, **Retryable**.

---

## E1. `credentials_missing`

| Aspect | Detail |
|---|---|
| Code | `credentials_missing` |
| Message | `"No AWS credentials found. Configure Bedrock credentials in Settings or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."` |
| Trigger | `CredentialResolver` returns `null` — all 4 resolution steps failed |
| Recovery | Provider marked `not_configured`. Hidden from model picker. No error shown at startup. Error shown only if user explicitly tries to start a Bedrock session. |
| Blast radius | Bedrock provider only. Codex unaffected. |
| Operator visibility | `debug` log: `"Bedrock credentials not found, provider not configured"` |
| Retryable | No — requires user action (add credentials) |

---

## E2. `credentials_invalid`

| Aspect | Detail |
|---|---|
| Code | `credentials_invalid` |
| Message | `"AWS credentials are invalid. Check your access key ID and secret access key. Error: {awsError}"` |
| Trigger | Bedrock API returns HTTP 403 Forbidden or `InvalidSignatureException` |
| Recovery | Emit error event to UI. Mark provider `unavailable`. User must fix credentials and restart session. |
| Blast radius | Current session only. Other sessions unaffected. |
| Operator visibility | `error` log: `"Bedrock credentials invalid for session {threadId}: {awsError}"` |
| Retryable | No — requires credential fix |

---

## E3. `model_not_available`

| Aspect | Detail |
|---|---|
| Code | `model_not_available` |
| Message | `"Model {modelId} is not enabled in region {region}. Enable it in the AWS Bedrock console at https://console.aws.amazon.com/bedrock/"` |
| Trigger | Bedrock returns `AccessDeniedException` with message containing "model" or `ValidationException` for unknown model |
| Recovery | Emit error event. Session state → `stopped`. User must enable model in AWS console or choose different model. |
| Blast radius | Current session only. |
| Operator visibility | `error` log: `"Model {modelId} not available in {region} for session {threadId}"` |
| Retryable | No — requires AWS console action |

---

## E4. `rate_limited`

| Aspect | Detail |
|---|---|
| Code | `rate_limited` |
| Message (during retry) | `"Bedrock rate limit hit. Retrying in {delayMs}ms... (attempt {n}/3)"` |
| Message (exhausted) | `"Bedrock rate limit exceeded after 3 retries. Please wait and try again."` |
| Trigger | HTTP 429 or `ThrottlingException` from Bedrock API |
| Recovery | Retry with exponential backoff: delays `[1000, 2000, 4000]` ms. Max 3 retries. If exhausted, emit error event. |
| Blast radius | Current turn only. Session preserved. |
| Operator visibility | `warn` log on each retry: `"Rate limited, retry {n}/3 in {delay}ms"`. `error` log if exhausted. |
| Retryable | Yes — automatic retry, then manual retry by user |

---

## E5. `service_error`

| Aspect | Detail |
|---|---|
| Code | `service_error` |
| Message | `"Bedrock service error ({statusCode}). Retrying..."` / `"Bedrock service unavailable after 3 retries. Please try again later."` |
| Trigger | HTTP 5xx from Bedrock API |
| Recovery | Retry with exponential backoff: delays `[2000, 4000, 8000]` ms. Max 3 retries. |
| Blast radius | Current turn only. |
| Operator visibility | `error` log: `"Bedrock 5xx error: {statusCode} {message}"` |
| Retryable | Yes — automatic then manual |

---

## E6. `tool_error`

| Aspect | Detail |
|---|---|
| Code | `tool_error` |
| Message | `"Tool '{toolName}' failed: {errorMessage}"` |
| Trigger | Exception in ToolExecutor during file/shell/browser operation |
| Recovery | Return `{ is_error: true, output: "Tool '{toolName}' failed: {errorMessage}" }` to model. Model can retry or explain failure to user. Turn continues. |
| Blast radius | Single tool call. Turn and session continue. |
| Operator visibility | `warn` log: `"Tool {toolName} failed in session {threadId}: {error}"` |
| Retryable | Yes — model can retry the tool call |

---

## E7. `shell_timeout`

| Aspect | Detail |
|---|---|
| Code | `shell_timeout` |
| Message | `"Command timed out after {timeoutMs}ms and was killed."` |
| Trigger | Shell command process exceeds `shell_timeout_ms` |
| Recovery | Kill process (SIGTERM, then SIGKILL after 5s). Return `{ is_error: true, output: "Command timed out after {timeoutMs}ms and was killed." }` to model. |
| Blast radius | Single tool call. |
| Operator visibility | `warn` log: `"Shell command timed out after {timeoutMs}ms in session {threadId}: {command}"` |
| Retryable | Yes — model can try a different command |

---

## E8. `session_corrupt`

| Aspect | Detail |
|---|---|
| Code | `session_corrupt` |
| Message | (Internal only — not shown to user) |
| Trigger | `JSON.parse` fails on session file during startup scan |
| Recovery | Log warning. Delete corrupt file. Session is lost — treated as if it never existed. |
| Blast radius | Single session. Other sessions unaffected. |
| Operator visibility | `warn` log: `"Corrupt session file deleted: {filePath}"` |
| Retryable | No — data is lost |

---

## E9. `context_overflow`

| Aspect | Detail |
|---|---|
| Code | `context_overflow` |
| Message | (Internal only — no user-facing error. Context silently truncated.) |
| Trigger | Token count of conversation history exceeds `min(max_context_tokens, model.context_window)` |
| Recovery | Truncate oldest non-system messages until within budget. Keep system prompt + last user message + pending tool results. |
| Blast radius | Current turn — older context is lost. |
| Operator visibility | `warn` log: `"Context truncated for session {threadId}: {removedCount} messages removed, {tokensBefore} → {tokensAfter} tokens"` |
| Retryable | N/A — automatic recovery |

---

## E10. `network_error`

| Aspect | Detail |
|---|---|
| Code | `network_error` |
| Message | `"Connection to Bedrock failed: {errorMessage}. Check your network connection and try again."` |
| Trigger | AI SDK throws `fetch` error, `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT` |
| Recovery | Emit error event. Turn fails but session state preserved at last successful turn. User can retry. |
| Blast radius | Current turn only. |
| Operator visibility | `error` log: `"Network error for session {threadId}: {error}"` |
| Retryable | Yes — user can retry the turn |

---

## E11. `sandbox_violation`

| Aspect | Detail |
|---|---|
| Code | `sandbox_violation` |
| Message | `"Access denied: path '{path}' resolves outside the project directory."` |
| Trigger | `validatePath()` detects resolved path does not start with `projectDir` |
| Recovery | Return `{ is_error: true, output: "Access denied: path '{path}' resolves outside the project directory." }` to model. Tool call rejected. No file operation performed. |
| Blast radius | Single tool call. |
| Operator visibility | `warn` log: `"Sandbox violation in session {threadId}: path '{path}' resolved to '{resolved}' outside '{projectDir}'"` |
| Retryable | Yes — model can try a valid path |

---

## E12. `browser_timeout`

| Aspect | Detail |
|---|---|
| Code | `browser_timeout` |
| Message | `"URL fetch timed out after {timeoutMs}ms: {url}"` |
| Trigger | `fetch()` AbortController fires after `browser_timeout_ms` |
| Recovery | Return `{ is_error: true, output: "URL fetch timed out after {timeoutMs}ms" }` to model. |
| Blast radius | Single tool call. |
| Operator visibility | `warn` log: `"Browser tool timeout for {url} in session {threadId}"` |
| Retryable | Yes — model can try different URL or retry |

---

## E13. `browser_invalid_url`

| Aspect | Detail |
|---|---|
| Code | `browser_invalid_url` |
| Message | `"Invalid URL: only HTTP and HTTPS protocols are allowed. Got: {url}"` |
| Trigger | URL does not start with `http://` or `https://`, or fails `z.string().url()` validation |
| Recovery | Return `{ is_error: true, output: message }` to model immediately. No fetch attempted. |
| Blast radius | Single tool call. |
| Operator visibility | `info` log: `"Browser tool rejected invalid URL: {url}"` |
| Retryable | Yes — model can provide valid URL |

---

## E14. `unknown_tool`

| Aspect | Detail |
|---|---|
| Code | `unknown_tool` |
| Message | `"Unknown tool: '{toolName}'. Available tools: file_read, file_write, file_edit, shell, browser."` |
| Trigger | Model requests a tool name not in the defined set |
| Recovery | Return `{ is_error: true, output: message }` to model. |
| Blast radius | Single tool call. |
| Operator visibility | `warn` log: `"Unknown tool requested: {toolName} in session {threadId}"` |
| Retryable | Yes — model can use a valid tool |

---

## E15. `max_steps_reached`

| Aspect | Detail |
|---|---|
| Code | `max_steps_reached` |
| Message | `"Maximum tool execution steps ({maxSteps}) reached. Turn ending."` |
| Trigger | AI SDK `maxSteps` limit hit during `generateText()` loop |
| Recovery | Turn ends normally with `finishReason: "max-steps"`. Warning event emitted. Session persisted. User can send another turn. |
| Blast radius | Current turn. |
| Operator visibility | `warn` log: `"Max steps ({maxSteps}) reached in session {threadId}, turn {turnId}"` |
| Retryable | Yes — user can continue in next turn |
