import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as executor from "./executor";

describe("executor", () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-")));

  describe("file_read", () => {
    it("reads existing file", async () => {
      fs.writeFileSync(path.join(root, "hello.txt"), "world");
      const r = await executor.execute("file_read", { path: "hello.txt" }, { root });
      expect(r.error).toBe(false);
      expect(r.output).toBe("world");
    });

    it("returns error for nonexistent file", async () => {
      const r = await executor.execute("file_read", { path: "nope.txt" }, { root });
      expect(r.error).toBe(true);
      expect(r.output).toContain("File not found");
    });

    it("rejects path traversal", async () => {
      const r = await executor.execute("file_read", { path: "../../../etc/passwd" }, { root });
      expect(r.error).toBe(true);
      expect(r.output).toContain("Access denied");
    });

    it("truncates large file output", async () => {
      const big = "x".repeat(200_000);
      fs.writeFileSync(path.join(root, "big.txt"), big);
      const r = await executor.execute("file_read", { path: "big.txt" }, { root });
      expect(r.error).toBe(false);
      expect(r.output.length).toBeLessThanOrEqual(100_100); // 100k + truncation notice
    });
  });

  describe("file_write", () => {
    it("creates new file", async () => {
      const r = await executor.execute("file_write", { path: "new.txt", content: "hello" }, { root });
      expect(r.error).toBe(false);
      expect(fs.readFileSync(path.join(root, "new.txt"), "utf-8")).toBe("hello");
    });

    it("creates parent directories", async () => {
      const r = await executor.execute("file_write", { path: "deep/nested/file.ts", content: "code" }, { root });
      expect(r.error).toBe(false);
      expect(fs.existsSync(path.join(root, "deep", "nested", "file.ts"))).toBe(true);
    });

    it("overwrites existing file", async () => {
      fs.writeFileSync(path.join(root, "overwrite.txt"), "old");
      await executor.execute("file_write", { path: "overwrite.txt", content: "new" }, { root });
      expect(fs.readFileSync(path.join(root, "overwrite.txt"), "utf-8")).toBe("new");
    });

    it("rejects path outside project", async () => {
      const r = await executor.execute("file_write", { path: "../../escape.txt", content: "bad" }, { root });
      expect(r.error).toBe(true);
      expect(r.output).toContain("Access denied");
    });

    it("writes empty content", async () => {
      const r = await executor.execute("file_write", { path: "empty.txt", content: "" }, { root });
      expect(r.error).toBe(false);
      expect(fs.readFileSync(path.join(root, "empty.txt"), "utf-8")).toBe("");
    });
  });

  describe("file_edit", () => {
    it("replaces first occurrence", async () => {
      fs.writeFileSync(path.join(root, "edit.txt"), "foo bar foo");
      const r = await executor.execute("file_edit", { path: "edit.txt", old_text: "foo", new_text: "baz" }, { root });
      expect(r.error).toBe(false);
      expect(fs.readFileSync(path.join(root, "edit.txt"), "utf-8")).toBe("baz bar foo");
    });

    it("returns error when text not found", async () => {
      fs.writeFileSync(path.join(root, "noedit.txt"), "hello");
      const r = await executor.execute("file_edit", { path: "noedit.txt", old_text: "xyz", new_text: "abc" }, { root });
      expect(r.error).toBe(true);
      expect(r.output).toContain("not found");
    });

    it("rejects path traversal", async () => {
      const r = await executor.execute("file_edit", { path: "../secret", old_text: "a", new_text: "b" }, { root });
      expect(r.error).toBe(true);
      expect(r.output).toContain("Access denied");
    });
  });

  describe("shell", () => {
    it("executes command and returns output", async () => {
      const r = await executor.execute("shell", { command: "echo hello" }, { root });
      expect(r.error).toBe(false);
      expect(r.output).toContain("hello");
      expect(r.output).toContain("Exit code: 0");
    });

    it("returns non-zero exit code", async () => {
      const r = await executor.execute("shell", { command: "exit 42" }, { root });
      expect(r.output).toContain("Exit code: 42");
      // Non-zero exit is info, not a tool error
      expect(r.error).toBe(false);
    });

    it("times out long commands", async () => {
      const r = await executor.execute("shell", { command: "sleep 60" }, { root, timeout: 200 });
      expect(r.error).toBe(true);
      expect(r.output).toContain("timed out");
    });

    it("truncates long output", async () => {
      const r = await executor.execute("shell", { command: "python3 -c \"print('x' * 20000)\"" }, { root });
      expect(r.output.length).toBeLessThanOrEqual(10_200);
    });

    it("runs in project directory", async () => {
      const r = await executor.execute("shell", { command: "pwd" }, { root });
      expect(r.output).toContain(root);
    });
  });

  describe("browser", () => {
    it("rejects non-HTTP URLs", async () => {
      const r = await executor.execute("browser", { url: "file:///etc/passwd" }, { root });
      expect(r.error).toBe(true);
      expect(r.output).toContain("only HTTP and HTTPS");
    });

    it("rejects invalid URLs", async () => {
      const r = await executor.execute("browser", { url: "not-a-url" }, { root });
      expect(r.error).toBe(true);
    });

    it("times out slow URLs", async () => {
      // Use a non-routable IP to guarantee timeout (RFC 5737 TEST-NET)
      const r = await executor.execute("browser", { url: "http://192.0.2.1:1" }, { root, browserTimeout: 200 });
      expect(r.error).toBe(true);
      // May be timeout or connection refused depending on OS
      expect(r.output.length).toBeGreaterThan(0);
    });
  });
});
