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

  /**
   * `neverSeen` 경고 보류의 배선(구현 리뷰 m3·접근성 감사 m6). 이 경고는 세션에 한 번뿐이라 다음 폴이 대신 말해
   * 주지 않는다 — 발화 줄이 빠지거나 처분이 조회 가드 안으로 들어가면(상한·추적 시작 뒤엔 영영 안 돈다) 경고가
   * 조용히 사라진다. 10폴 × 60초라 실제 시계 컴포넌트 테스트로는 밟을 수 없어 구조를 잠근다.
   */
  it("웹 훅: 이벤트 자리에서 보류하고, 처분은 조회 가드 밖에서 매 폴 돌며, fire는 이벤트 창구로 나간다", () => {
    const src = read("src/hooks/useTransitGuide.ts");
    expect(src).toMatch(/event\.kind === "neverSeen" \? neverSeenWarningDeferred\(/);
    expect(src).toMatch(/else announceEvent\(event\);/);
    const fn = src.slice(src.indexOf("const refreshPosition = useCallback"), src.indexOf("const pollOnce = useCallback"));
    const guardEnd = fn.indexOf("setPositionClock(Date.now());");
    const pending = fn.indexOf("neverSeenPendingStep(");
    expect(guardEnd).toBeGreaterThan(0);
    expect(pending, "처분은 조회 가드(if 블록)가 끝난 뒤에 있어야 한다").toBeGreaterThan(guardEnd);
    expect(fn).toMatch(/if \(verdict === "fire"\) announceEvent\(\{ kind: "neverSeen" \}\);/);
    // 도착 폴의 성공·실패 두 경로가 모두 위치 조회(= 처분)를 지난다.
    const poll = src.slice(src.indexOf("const pollOnce = useCallback"));
    expect(poll.match(/await refreshPosition\(\);/g)?.length).toBe(2);
  });

  it("조망 머리 문장은 현재역을 말하지 않는다(위원장 판정 2026-09-23 — 안내 행·정차역 행 두 곳만)", () => {
    const overview = read("ios/Gildongmu/Directions/GuideOverviewSheet.swift");
    expect(overview).toContain("model.statusLineText(state: state, leg: leg, now: model.positionClock, speaksLocated: false)");
    expect(overview).not.toMatch(/speaksLocated: true/);
    const model = read("ios/Gildongmu/Directions/TransitGuideModel.swift");
    expect(model).toMatch(/if speaksLocated \{ parts\.append\(located\) \}/);
  });

  it("iOS 모델: 같은 구조(보류는 dispatch, 처분은 조회 가드 밖, fire는 handle(event:))", () => {
    const src = read("ios/Gildongmu/Directions/TransitGuideModel.swift");
    expect(src).toMatch(/if case \.neverSeen = event,\s+let deferred = transitNeverSeenWarningDeferred\(/);
    const fn = src.slice(src.indexOf("private func refreshPosition(seq: Int) async {"));
    const guardEnd = fn.indexOf("positionClock = nowMs()");
    const pending = fn.indexOf("transitNeverSeenPendingStep(");
    expect(guardEnd).toBeGreaterThan(0);
    expect(pending).toBeGreaterThan(guardEnd);
    expect(fn).toMatch(/if verdict == \.fire \{ handle\(event: \.neverSeen\) \}/);
    // 보류 저장과 "그 밖 이벤트는 그대로" — 빠지면 경고가 영영 안 나가거나 모든 이벤트가 침묵한다(검증 리뷰 m1).
    expect(src).toMatch(/neverSeenPending = deferred\n/);
    expect(src).toMatch(/\} else \{\s*handle\(event: event\)\s*\}/);
    // 폴 루프가 도착 폴 뒤에 위치 조회(= 처분)를 부른다.
    expect(src).toMatch(/await self\.pollOnce\(\)[\s\S]{0,400}await self\.refreshPosition\(seq: self\.seq\)/);
  });

  it("클라이언트 조회 예산은 웹·iOS 같은 값이다(구현 리뷰 M1 — 한쪽만 바뀌면 한 플랫폼만 도착 폴이 밀린다)", () => {
    const web = read("src/lib/transit-riding-position.ts").match(/POSITION_CLIENT_TIMEOUT_MS = ([\d_]+);/)?.[1];
    const kit = read("ios/GildongmuKit/Sources/GildongmuKit/TransitRidingPosition.swift")
      .match(/transitPositionClientTimeoutSeconds: TimeInterval = (\d+)/)?.[1];
    expect(Number(web?.replace(/_/g, ""))).toBe(Number(kit) * 1000);
  });
});
