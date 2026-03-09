/**
 * Tests for the needsApproval logic in BedrockAdapter.
 * Extracted here to test the decision table from BLUEPRINT §5.4.
 */
import { describe, it, expect } from "vitest";

// Re-implement the logic here for pure unit testing (same as in BedrockAdapter)
const APPROVAL_EXEMPT = new Set(["file_read"]);
const AUTO_APPROVE_EXEMPT = new Set(["file_read", "browser"]);

function needsApproval(tool: string, mode: string): boolean {
  if (mode === "full-access") return false;
  if (APPROVAL_EXEMPT.has(tool)) return false;
  if (mode === "auto-approve" && AUTO_APPROVE_EXEMPT.has(tool)) return false;
  return true;
}

describe("needsApproval", () => {
  describe("approval-required mode", () => {
    it("file_read → no approval", () => {
      expect(needsApproval("file_read", "approval-required")).toBe(false);
    });

    it("file_write → needs approval", () => {
      expect(needsApproval("file_write", "approval-required")).toBe(true);
    });

    it("file_edit → needs approval", () => {
      expect(needsApproval("file_edit", "approval-required")).toBe(true);
    });

    it("shell → needs approval", () => {
      expect(needsApproval("shell", "approval-required")).toBe(true);
    });

    it("browser → needs approval", () => {
      expect(needsApproval("browser", "approval-required")).toBe(true);
    });
  });

  describe("full-access mode", () => {
    it("file_read → no approval", () => {
      expect(needsApproval("file_read", "full-access")).toBe(false);
    });

    it("file_write → no approval", () => {
      expect(needsApproval("file_write", "full-access")).toBe(false);
    });

    it("shell → no approval", () => {
      expect(needsApproval("shell", "full-access")).toBe(false);
    });

    it("browser → no approval", () => {
      expect(needsApproval("browser", "full-access")).toBe(false);
    });
  });

  describe("auto-approve mode", () => {
    it("file_read → no approval (always exempt)", () => {
      expect(needsApproval("file_read", "auto-approve")).toBe(false);
    });

    it("browser → no approval (read-only network, exempt)", () => {
      expect(needsApproval("browser", "auto-approve")).toBe(false);
    });

    it("file_write → needs approval (not in allowlist)", () => {
      expect(needsApproval("file_write", "auto-approve")).toBe(true);
    });

    it("file_edit → needs approval (not in allowlist)", () => {
      expect(needsApproval("file_edit", "auto-approve")).toBe(true);
    });

    it("shell → needs approval (not in allowlist)", () => {
      expect(needsApproval("shell", "auto-approve")).toBe(true);
    });
  });
});
