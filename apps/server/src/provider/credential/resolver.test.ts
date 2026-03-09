import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as resolver from "./resolver";

describe("credential resolver", () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cred-test-")));
  const saved: Record<string, string | undefined> = {};

  function setEnv(key: string, val: string | undefined) {
    saved[key] = process.env[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }

  function clearAwsEnv() {
    setEnv("AWS_ACCESS_KEY_ID", undefined);
    setEnv("AWS_SECRET_ACCESS_KEY", undefined);
    setEnv("AWS_REGION", undefined);
    setEnv("AWS_SESSION_TOKEN", undefined);
    setEnv("AWS_PROFILE", undefined);
  }

  beforeEach(() => clearAwsEnv());
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("resolves from env vars", async () => {
    setEnv("AWS_ACCESS_KEY_ID", "AKIATEST1234567890");
    setEnv("AWS_SECRET_ACCESS_KEY", "secret123");
    setEnv("AWS_REGION", "us-west-2");
    const result = await resolver.resolve(dir);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("env");
    expect(result!.accessKeyId).toBe("AKIATEST1234567890");
    expect(result!.region).toBe("us-west-2");
  });

  it("uses default region when AWS_REGION not set", async () => {
    setEnv("AWS_ACCESS_KEY_ID", "AKIATEST1234567890");
    setEnv("AWS_SECRET_ACCESS_KEY", "secret123");
    const result = await resolver.resolve(dir);
    expect(result).not.toBeNull();
    expect(result!.region).toBe("us-east-1");
  });

  it("includes session token when set", async () => {
    setEnv("AWS_ACCESS_KEY_ID", "AKIATEST1234567890");
    setEnv("AWS_SECRET_ACCESS_KEY", "secret123");
    setEnv("AWS_SESSION_TOKEN", "token123");
    const result = await resolver.resolve(dir);
    expect(result).not.toBeNull();
    expect(result!.sessionToken).toBe("token123");
  });

  it("resolves from config file when no env vars", async () => {
    const config = {
      bedrock: {
        accessKeyId: "AKIACONFIG12345",
        secretAccessKey: "configsecret",
        region: "eu-west-1",
      },
    };
    fs.writeFileSync(path.join(dir, "provider-config.json"), JSON.stringify(config));
    const result = await resolver.resolve(dir);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("config");
    expect(result!.accessKeyId).toBe("AKIACONFIG12345");
    expect(result!.region).toBe("eu-west-1");
  });

  it("returns null when no credentials found", async () => {
    const empty = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "nocred-")));
    const result = await resolver.resolve(empty);
    expect(result).toBeNull();
  });

  it("env vars take precedence over config file", async () => {
    setEnv("AWS_ACCESS_KEY_ID", "AKIAENV12345");
    setEnv("AWS_SECRET_ACCESS_KEY", "envsecret");
    const config = { bedrock: { accessKeyId: "AKIACONFIG", secretAccessKey: "configsecret" } };
    fs.writeFileSync(path.join(dir, "provider-config.json"), JSON.stringify(config));
    const result = await resolver.resolve(dir);
    expect(result!.method).toBe("env");
    expect(result!.accessKeyId).toBe("AKIAENV12345");
  });

  it("skips invalid config file JSON", async () => {
    const bad = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "badcfg-")));
    fs.writeFileSync(path.join(bad, "provider-config.json"), "NOT JSON{{");
    const result = await resolver.resolve(bad);
    expect(result).toBeNull();
  });
});
