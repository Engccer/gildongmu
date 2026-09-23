import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E35 표시 전용 계약의 2선(1선은 구조 — 위치 상태가 리듀서 밖에 있다). 승차 상태 머신 파일이 위치 모듈을
 * 참조하는 순간, 위치가 도착·승격·하차·neverSeen 판정에 스며드는 경로가 열린다(판정서 2026-08-23 §3 —
 * 그 접붙이기는 BLOCKER 11건으로 기각됐다). 판정은 도착 API가 한다.
 */
const ROOT = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("승차 상태 머신은 실시간 열차 위치를 모른다(E35 표시 전용)", () => {
  it("웹 리듀서 transit-guide.ts", () => {
    const src = read("src/lib/transit-guide.ts");
    expect(src).not.toMatch(/transit-riding-position|transit-position|realtimePosition/);
  });

  it("Kit 리듀서 TransitGuide.swift", () => {
    const src = read("ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift");
    expect(src).not.toMatch(/RidingPosition|PositionOutcome|PositionBinding|realtimePosition/);
  });

  it("기존 조망·앵커 판정도 위치를 모른다(후처리만 얹는다 — 안드로이드 이식본과 짝)", () => {
    for (const rel of [
      "src/lib/transit-progress-overview.ts",
      "ios/GildongmuKit/Sources/GildongmuKit/TransitProgressOverview.swift",
      "ios/GildongmuKit/Sources/GildongmuKit/TransitSurroundingsAnchor.swift",
    ]) {
      expect(read(rel), rel).not.toMatch(/RidingPosition|riding-position/);
    }
  });
});
