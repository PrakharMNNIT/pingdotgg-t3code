import { Schema } from "effect";
import { ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];

export const BEDROCK_REASONING_EFFORT_OPTIONS = ["high", "medium", "low"] as const;
export type BedrockReasoningEffort = (typeof BEDROCK_REASONING_EFFORT_OPTIONS)[number];

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const BedrockModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(BEDROCK_REASONING_EFFORT_OPTIONS)),
});
export type BedrockModelOptions = typeof BedrockModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  bedrock: Schema.optional(BedrockModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

type ModelOption = {
  readonly slug: string;
  readonly name: string;
};

export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
  ],
  bedrock: [
    { slug: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { slug: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { slug: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { slug: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { slug: "claude-opus-4.1", name: "Claude Opus 4.1" },
  ],
} as const satisfies Record<ProviderKind, readonly ModelOption[]>;
export type ModelOptionsByProvider = typeof MODEL_OPTIONS_BY_PROVIDER;

type BuiltInModelSlug = ModelOptionsByProvider[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});

export const DEFAULT_MODEL_BY_PROVIDER = {
  codex: "gpt-5.4",
  bedrock: "claude-sonnet-4",
} as const satisfies Record<ProviderKind, ModelSlug>;

export const MODEL_SLUG_ALIASES_BY_PROVIDER = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  bedrock: {
    "opus-4.5": "claude-opus-4.5",
    "sonnet-4.5": "claude-sonnet-4.5",
    "sonnet-4": "claude-sonnet-4",
    "haiku-4.5": "claude-haiku-4.5",
    "opus-4.1": "claude-opus-4.1",
  },
} as const satisfies Record<ProviderKind, Record<string, ModelSlug>>;

export type ReasoningEffort = CodexReasoningEffort | BedrockReasoningEffort;

export const REASONING_EFFORT_OPTIONS_BY_PROVIDER = {
  codex: CODEX_REASONING_EFFORT_OPTIONS,
  bedrock: BEDROCK_REASONING_EFFORT_OPTIONS,
} as const satisfies Record<ProviderKind, readonly ReasoningEffort[]>;

export const DEFAULT_REASONING_EFFORT_BY_PROVIDER = {
  codex: "high",
  bedrock: "high",
} as const satisfies Record<ProviderKind, ReasoningEffort | null>;

type BedrockCatalogSlug = (typeof MODEL_OPTIONS_BY_PROVIDER)["bedrock"][number]["slug"];

/** Bedrock model ID mapping: slug → full Bedrock model ID. Keys must match catalog slugs. */
export const BEDROCK_MODEL_IDS = {
  "claude-opus-4.5": "anthropic.claude-opus-4-5-20251101-v1:0",
  "claude-sonnet-4.5": "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "claude-sonnet-4": "anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-haiku-4.5": "anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-opus-4.1": "anthropic.claude-opus-4-1-20250805-v1:0",
} as const satisfies Record<BedrockCatalogSlug, string>;
export type BedrockModelSlug = keyof typeof BEDROCK_MODEL_IDS;
