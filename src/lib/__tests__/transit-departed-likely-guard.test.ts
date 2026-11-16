import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A74 2선 소스 가드(spec `2026-11-17-a74-departed-train-at-board-stop-design.md` §2). `departedLikely`는 위치
 * 피드에서 온 판정이라 **승격을 막는 쪽으로만** 읽는다 — 판정서 2026-08-23 §3이 기각한 "위치로 추적 대체"가
 * 이 필드를 타고 돌아오지 않게, 리듀서에서 읽는 자리를 승차 국면 판정과 대기 목록 풀 둘로 고정한다.
 * 하차역 도착 확정(`commitMatched`)이 읽으면 떠난 열차 표식이 도착 알림을 막는다.
 */
const SRC = readFileSync(join(__dirname, "..", "transit-guide.ts"), "utf8");

function body(name: string): string {
  const start = SRC.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = SRC.indexOf("\nfunction ", start + 1);
  const nextExport = SRC.indexOf("\nexport ", start + 1);
  const ends = [next, nextExport].filter((i) => i > -1);
  return SRC.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("departedLikely 읽기 자리(A74)", () => {
  it("리듀서에서 읽는 함수는 commitBoardingMatched와 boardablePool뿐이다", () => {
    const reads = [...SRC.matchAll(/\.departedLikely\b/g)].length;
    const allowed =
      [...body("commitBoardingMatched").matchAll(/\.departedLikely\b/g)].length +
      [...body("boardablePool").matchAll(/\.departedLikely\b/g)].length;
    expect(allowed).toBeGreaterThan(0);
    expect(reads).toBe(allowed);
  });

  it("하차역 도착 확정(commitMatched)은 떠남 표식·래치를 읽지 않는다", () => {
    const riding = body("commitMatched");
    expect(riding).not.toMatch(/departedLikely|boardDepartedSeen|boardConfirmPending|platformAgeSeconds/);
  });
});
