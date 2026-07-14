import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("config", () => {
  beforeEach(() => {
    process.env.GILDONGMU_CONFIG_DIR = mkdtempSync(join(tmpdir(), "gil-"));
    delete process.env.GILDONGMU_API_URL;
  });

  it("기본 apiUrl은 프로덕션", async () => {
    const { readConfig } = await import("../lib/config.js");
    expect((await readConfig()).apiUrl).toBe("https://gildongmu.vercel.app");
  });

  it("GILDONGMU_API_URL env가 파일보다 우선", async () => {
    process.env.GILDONGMU_API_URL = "http://localhost:3000";
    const { readConfig } = await import("../lib/config.js");
    expect((await readConfig()).apiUrl).toBe("http://localhost:3000");
  });

  it("writeConfig 후 readConfig 왕복", async () => {
    const { readConfig, writeConfig } = await import("../lib/config.js");
    await writeConfig({ location: { label: "길동", lat: 37.5384, lng: 127.1368 } });
    expect((await readConfig()).location?.label).toBe("길동");
  });
});
