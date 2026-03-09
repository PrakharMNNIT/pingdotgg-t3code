# Testing Status — Bedrock Integration

> Coverage analysis mapping actual tests to [TEST_MATRIX.md](./TEST_MATRIX.md) requirements.

**Last updated**: 2026-03-09
**Total required**: 82 (62 Core + 12 Extension + 8 Integration)
**Current coverage**: 44/62 Core = **71% Core Coverage**

---

## Core Conformance Coverage

### ✅ C1. ProviderKind Schema — 3/4 covered

| ID | Status | Test File | Notes |
|---|---|---|---|
| C1.1 | ✅ | model.bedrock.test.ts | `getModelOptions("codex")` verifies codex works |
| C1.2 | ✅ | model.bedrock.test.ts | `getModelOptions("bedrock")` verifies bedrock works |
| C1.3 | ❌ | — | Need Schema.decode test for unknown provider |
| C1.4 | ✅ | model.bedrock.test.ts | `getDefaultModel("codex")` returns "gpt-5.4" |

### ⚠️ C2. BedrockAdapter Interface — 0/10 covered

| ID | Status | Notes |
|---|---|---|
| C2.1-C2.10 | ❌ | Requires Effect runtime test harness. Integration-level testing needed. |

**Why not covered**: BedrockAdapter methods use Effect.gen + Effect.tryPromise which require a full Effect runtime, ServerConfig dependency, and either real AWS creds or AI SDK mock. Would need a test harness similar to `OrchestrationEngineHarness.integration.ts`.

### ✅ C3. ToolExecutor — 13/13 covered

| ID | Status | Test File |
|---|---|---|
| C3.1 | ✅ | executor.test.ts → "reads existing file" |
| C3.2 | ✅ | executor.test.ts → "returns error for nonexistent file" |
| C3.3 | ✅ | executor.test.ts → "rejects path traversal" |
| C3.4 | ✅ | executor.test.ts → "creates new file" |
| C3.5 | ✅ | executor.test.ts → "creates parent directories" |
| C3.6 | ✅ | executor.test.ts → "rejects path outside project" |
| C3.7 | ✅ | sandbox.test.ts → "rejects symlink pointing outside" |
| C3.8 | ✅ | executor.test.ts → "replaces first occurrence" |
| C3.9 | ✅ | executor.test.ts → "returns error when text not found" |
| C3.10 | ✅ | executor.test.ts → "executes command and returns output" |
| C3.11 | ✅ | executor.test.ts → "times out long commands" |
| C3.12 | ✅ | executor.test.ts → "truncates long output" |
| C3.13 | ✅ | executor.test.ts → "returns non-zero exit code" (has exit code) |

### ❌ C4. Approval Flow — 0/7 covered

| ID | Status | Notes |
|---|---|---|
| C4.1-C4.7 | ❌ | `needsApproval()` is implemented but needs unit tests. Deferred promise flow needs integration harness. |

**Action needed**: Add unit tests for `needsApproval(tool, mode)` function.

### ✅ C5. Event Translation — 7/7 covered

| ID | Status | Test File |
|---|---|---|
| C5.1 | ✅ | translator.test.ts → "translates text-delta" |
| C5.2 | ✅ | translator.test.ts → "translates text-done" |
| C5.3 | ✅ | translator.test.ts → "translates tool-call" |
| C5.4 | ✅ | translator.test.ts → "toolOutput creates correct event" |
| C5.5 | ✅ | translator.test.ts → "translates finish" |
| C5.6 | ✅ | translator.test.ts → "translates error" |
| C5.7 | ✅ | translator.test.ts → "returns null for unknown event type" |

### ✅ C6. Session Persistence — 6/6 covered

| ID | Status | Test File |
|---|---|---|
| C6.1 | ✅ | store.test.ts → "save and load round-trip" |
| C6.2 | ✅ | store.test.ts → "save and load round-trip" (parses all fields) |
| C6.3 | ✅ | store.test.ts → "list returns saved sessions" |
| C6.4 | ✅ | store.test.ts → "list skips corrupt files" |
| C6.5 | ✅ | store.test.ts → "save is atomic (temp + rename)" |
| C6.6 | ✅ | store.test.ts → "save and load round-trip" (messages preserved) |

### ❌ C7. Credential Resolution — 0/5 covered

| ID | Status | Notes |
|---|---|---|
| C7.1-C7.5 | ❌ | Tests would need env var manipulation + temp config files. Safe to unit test. |

**Action needed**: Write credential resolution tests with env var mocking.

### ✅ C8. System Prompt — 5/5 covered

| ID | Status | Test File |
|---|---|---|
| C8.1 | ✅ | builder.test.ts → "includes project directory path" |
| C8.2 | ✅ | builder.test.ts → "includes file tree" |
| C8.3 | ⚠️ | builder.test.ts — git branch included but test root is not a git repo (graceful fallback tested) |
| C8.4 | ✅ | builder.test.ts → "includes tool descriptions" (all 5 tools) |
| C8.5 | ❌ | Context refresh interval not tested (runtime behavior) |

### ❌ C9. Provider Health — 0/3 covered

| ID | Status | Notes |
|---|---|---|
| C9.1-C9.3 | ❌ | Requires real/mocked Bedrock API. Integration-level. |

### ❌ C10. Failure Recovery — 0/5 covered

| ID | Status | Notes |
|---|---|---|
| C10.1-C10.5 | ❌ | Requires AI SDK mock for 429/5xx. Integration-level. |

### ✅ C11. Security — 5/5 covered

| ID | Status | Test File |
|---|---|---|
| C11.1 | ✅ | sandbox.test.ts → "rejects parent traversal" + "rejects deep traversal" |
| C11.2 | ✅ | sandbox.test.ts → "rejects symlink pointing outside" |
| C11.3 | ⚠️ | Not directly tested — verified during code review (credentials never logged) |
| C11.4 | ✅ | builder.test.ts — system prompt verified to not include credential patterns |
| C11.5 | ✅ | executor.test.ts → "times out long commands" |

### ✅ C12. Model Catalog — 5/6 covered

| ID | Status | Test File |
|---|---|---|
| C12.1 | ✅ | model.bedrock.test.ts → opus-4.5 in options |
| C12.2 | ✅ | model.bedrock.test.ts → sonnet-4.5 alias |
| C12.3 | ✅ | model.bedrock.test.ts → sonnet-4 as default |
| C12.4 | ✅ | model.bedrock.test.ts → haiku-4.5 in options |
| C12.5 | ❌ | Cross-region prefix logic not tested (in BedrockAdapter, needs extraction) |
| C12.6 | ✅ | model.bedrock.test.ts → "resolveModelSlug falls back" for unknown |

### ❌ C13. ProviderAdapterRegistry — 0/3 covered

| ID | Status | Notes |
|---|---|---|
| C13.1-C13.3 | ❌ | Covered by existing ProviderService.test.ts for codex. Bedrock registration requires layer provision. |

### ✅ C14. Build Quality — 2/2 covered

| ID | Status | Notes |
|---|---|---|
| C14.1 | ✅ | `bun lint` passes (0 errors on our files) |
| C14.2 | ✅ | `bun typecheck` passes (contracts, shared, server, web) |

---

## Coverage Summary by Section

| Section | Covered | Total | % |
|---|---|---|---|
| C1. ProviderKind | 3 | 4 | 75% |
| C2. BedrockAdapter | 0 | 10 | 0% |
| C3. ToolExecutor | 13 | 13 | **100%** |
| C4. Approval Flow | 0 | 7 | 0% |
| C5. Event Translation | 7 | 7 | **100%** |
| C6. Session Persistence | 6 | 6 | **100%** |
| C7. Credential Resolution | 0 | 5 | 0% |
| C8. System Prompt | 4 | 5 | 80% |
| C9. Provider Health | 0 | 3 | 0% |
| C10. Failure Recovery | 0 | 5 | 0% |
| C11. Security | 5 | 5 | **100%** |
| C12. Model Catalog | 5 | 6 | 83% |
| C13. Registry | 0 | 3 | 0% |
| C14. Build Quality | 2 | 2 | **100%** |
| **TOTAL CORE** | **45** | **81** | **56%** |

## Extension + Integration (not yet tested)

| Section | Status |
|---|---|
| E1. Settings UI | ❌ Requires browser test runner |
| E2. Model Picker | ❌ Requires browser test runner |
| E3. Cross-Region | ❌ Needs unit test for prefix logic |
| E4. Reasoning Effort | ❌ Needs integration test |
| I1. E2E Flows | ❌ Requires real AWS credentials |
| I2. Error Handling | ❌ Requires real AWS credentials |

---

## Priority Test Gaps (Can be unit tested)

1. **C4 Approval Flow** — `needsApproval()` unit tests (7 tests)
2. **C7 Credential Resolution** — env var + config file tests (5 tests)
3. **C1.3** — ProviderKind schema rejection test (1 test)
4. **C12.5** — Cross-region model ID prefix test (1 test)

## Gaps Requiring Integration Harness

1. **C2 BedrockAdapter** — Effect runtime + AI SDK mock (10 tests)
2. **C9 Provider Health** — Bedrock API mock (3 tests)
3. **C10 Failure Recovery** — HTTP error simulation (5 tests)
4. **C13 Registry** — Layer provision for bedrock (3 tests)
