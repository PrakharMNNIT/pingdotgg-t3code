import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as builder from "./builder";

describe("prompt builder", () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-")));

  it("includes project directory path", () => {
    const result = builder.build(root);
    expect(result).toContain(root);
  });

  it("includes file tree", () => {
    fs.writeFileSync(path.join(root, "index.ts"), "export {}");
    const result = builder.build(root);
    expect(result).toContain("index.ts");
  });

  it("includes tool descriptions", () => {
    const result = builder.build(root);
    expect(result).toContain("file_read");
    expect(result).toContain("file_write");
    expect(result).toContain("file_edit");
    expect(result).toContain("shell");
    expect(result).toContain("browser");
  });

  it("includes README content when present", () => {
    fs.writeFileSync(path.join(root, "README.md"), "# Test Project\nSome description");
    const result = builder.build(root);
    expect(result).toContain("Test Project");
  });

  it("handles missing README gracefully", () => {
    const empty = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "no-readme-")));
    const result = builder.build(empty);
    expect(result).toContain("no README found");
  });

  it("reads package.json for project name", () => {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "test-pkg", description: "A test" }));
    const result = builder.build(root);
    expect(result).toContain("test-pkg");
    expect(result).toContain("A test");
  });
});
