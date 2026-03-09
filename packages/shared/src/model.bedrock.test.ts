import { describe, it, expect } from "vitest";
import {
  getDefaultModel,
  getModelOptions,
  getReasoningEffortOptions,
  getDefaultReasoningEffort,
  normalizeModelSlug,
  resolveModelSlug,
} from "./model";

describe("bedrock model support", () => {
  it("getModelOptions returns bedrock models", () => {
    const opts = getModelOptions("bedrock");
    expect(opts.length).toBeGreaterThanOrEqual(5);
    expect(opts.some((o) => o.slug === "claude-opus-4.5")).toBe(true);
    expect(opts.some((o) => o.slug === "claude-sonnet-4")).toBe(true);
    expect(opts.some((o) => o.slug === "claude-haiku-4.5")).toBe(true);
  });

  it("getDefaultModel returns claude-sonnet-4 for bedrock", () => {
    expect(getDefaultModel("bedrock")).toBe("claude-sonnet-4");
  });

  it("normalizeModelSlug resolves bedrock aliases", () => {
    expect(normalizeModelSlug("opus-4.5", "bedrock")).toBe("claude-opus-4.5");
    expect(normalizeModelSlug("sonnet-4", "bedrock")).toBe("claude-sonnet-4");
    expect(normalizeModelSlug("haiku-4.5", "bedrock")).toBe("claude-haiku-4.5");
  });

  it("normalizeModelSlug returns null for null/empty", () => {
    expect(normalizeModelSlug(null, "bedrock")).toBeNull();
    expect(normalizeModelSlug("", "bedrock")).toBeNull();
    expect(normalizeModelSlug(undefined, "bedrock")).toBeNull();
  });

  it("resolveModelSlug falls back to default for unknown model", () => {
    expect(resolveModelSlug("gpt-4", "bedrock")).toBe("claude-sonnet-4");
    expect(resolveModelSlug("unknown-model", "bedrock")).toBe("claude-sonnet-4");
  });

  it("resolveModelSlug accepts known bedrock slug", () => {
    expect(resolveModelSlug("claude-opus-4.5", "bedrock")).toBe("claude-opus-4.5");
  });

  it("getReasoningEffortOptions returns bedrock options", () => {
    const opts = getReasoningEffortOptions("bedrock");
    expect(opts).toContain("high");
    expect(opts).toContain("medium");
    expect(opts).toContain("low");
    // bedrock does not have xhigh
    expect(opts).not.toContain("xhigh");
  });

  it("getDefaultReasoningEffort returns high for bedrock", () => {
    expect(getDefaultReasoningEffort("bedrock")).toBe("high");
  });

  it("codex models still work", () => {
    expect(getDefaultModel("codex")).toBe("gpt-5.4");
    expect(getModelOptions("codex").length).toBeGreaterThanOrEqual(5);
  });
});
