import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * McpServer에 넘기는 version은 initialize 응답으로 MCP 클라이언트에 보고되는 서버 버전이다.
 * 하드코딩이라 package.json과 갈라지며, 실제로 0.6.0 발행본이 0.5.0을 보고했다(2026-07-31 발견).
 * index.ts는 import하면 stdio 서버가 기동하므로 소스를 텍스트로 읽어 대조한다.
 */
describe("version drift", () => {
  it("McpServer version이 package.json version과 일치", () => {
    const pkgRoot = join(__dirname, "..", "..");
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string };
    const src = readFileSync(join(pkgRoot, "src", "index.ts"), "utf8");
    const declared = src.match(/version:\s*"([^"]+)"/)?.[1];
    expect(declared).toBe(pkg.version);
  });
});
