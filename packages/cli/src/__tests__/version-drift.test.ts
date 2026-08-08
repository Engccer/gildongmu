import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * citty meta.version은 `gil --version` 출력의 정본인데 하드코딩이라 package.json과 갈라진다.
 * 실제로 0.6.0으로 발행된 tarball이 0.5.0을 출력한 회귀가 있었다(2026-07-31 npx 실행으로 발견).
 * 릴리스 절차가 package.json만 올리고 소스를 놓치는 경로를 이 테스트가 막는다.
 * index.ts를 import하지 않고 텍스트로 읽는 것은 mcp 쪽과 대칭을 맞추기 위함이다(그쪽은 import가 곧 서버 기동).
 */
describe("version drift", () => {
  it("citty meta.version이 package.json version과 일치", () => {
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
