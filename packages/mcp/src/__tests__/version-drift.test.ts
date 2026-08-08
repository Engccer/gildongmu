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

  /**
   * CHANGELOG는 npm 페이지에서 사용자가 보는 유일한 변경 이력이라 갱신 누락이 곧 정보 부재다.
   * 버전만 올리고 이력을 안 적으면 어떤 게이트도 걸리지 않으므로(빌드·테스트 무관) 여기서 막는다.
   */
  it("CHANGELOG에 현재 버전 항목이 있다", () => {
    const pkgRoot = join(__dirname, "..", "..");
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string };
    const changelog = readFileSync(join(pkgRoot, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`## [${pkg.version}]`);
  });

  /**
   * `files`에 적지 않으면 tarball에서 조용히 빠진다 — npm이 항상 포함하는 것은
   * package.json·README·LICENSE뿐이고 CHANGELOG는 그 목록에 없다(2026-08-08 `npm pack` 실측).
   */
  it("CHANGELOG가 npm 패키징 대상에 들어 있다", () => {
    const pkgRoot = join(__dirname, "..", "..");
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { files?: string[] };
    expect(pkg.files).toContain("CHANGELOG.md");
  });
});
