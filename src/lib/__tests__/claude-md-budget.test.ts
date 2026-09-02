import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CLAUDE.md는 매 세션·매 리뷰어 서브에이전트가 전량 읽는다 — 크기가 곧 토큰 비용이다.
// 2026-09-02 실측: 두 달 만에 26KB → 175KB(세션 시작 비용의 59%, 하루 26회 읽힘)로 불어 68KB로 축소했다.
// 넘으면 항목을 지우는 것이 아니라 상세를 docs/INTEGRATIONS.md(외부 통합)·docs/PATTERNS.md(그 밖)의
// 같은 제목 절로 옮기고 CLAUDE.md에는 규칙 한두 줄 + `→ INTEGRATIONS`/`→ PATTERNS` 참조만 남긴다.
const BUDGET_BYTES = 80_000;

describe("CLAUDE.md 크기 예산", () => {
  it(`CLAUDE.md는 ${BUDGET_BYTES.toLocaleString("en-US")} bytes 이하다`, () => {
    const path = fileURLToPath(new URL("../../../CLAUDE.md", import.meta.url));
    const size = readFileSync(path).byteLength;
    expect(size, "상세를 docs/INTEGRATIONS.md·docs/PATTERNS.md로 옮길 것").toBeLessThanOrEqual(BUDGET_BYTES);
  });
});
