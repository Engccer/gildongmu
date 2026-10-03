import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * iOS 도보·자동차 안내의 돌아가기 국면 배선(E63 spec §3.4·§3.5·§3.8). 앱 타깃은 테스트 레인이 없어 소비 배선을 소스로 잠근다
 * (판정은 Kit·공유 fixture가 잠근다). 되돌리면 이탈 확정 즉시 새 경로를 받던 종전 동작이 조용히 돌아온다.
 */
const beacon = readFileSync(join(__dirname, "../../../ios/Gildongmu/Directions/BeaconModel.swift"), "utf8");

function caseBlock(start: string, end: string): string {
  const a = beacon.indexOf(start);
  const b = beacon.indexOf(end, a + start.length);
  expect(a, start).toBeGreaterThanOrEqual(0);
  expect(b, end).toBeGreaterThan(a);
  return beacon.slice(a, b);
}

describe("BeaconModel 돌아가기 국면 배선(E63)", () => {
  const offRoute = caseBlock("case let .offRoute(notice, reason, guidance, side, returnRelDeg, firstSpoken):", "case let .backOnRoute(spoken):");
  const backOnRoute = caseBlock("case let .backOnRoute(spoken):", "case let .rerouteNeeded(reason):");
  const rerouteNeeded = caseBlock("case let .rerouteNeeded(reason):", "case .uncertainEnter:");

  it("이탈 확정에서 자동 조회는 운전자 채널만 연다 — 그 밖의 트리거는 rerouteNeeded", () => {
    const calls = offRoute.match(/maybeFetchProposal\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(offRoute).toMatch(/if notice == \.confirm \{ maybeFetchProposal\(source: "driver"\) \}/);
    const driver = offRoute.slice(offRoute.indexOf("if driverChannel {"), offRoute.indexOf("let text = GuideText.offRoute("));
    expect(driver).toContain('maybeFetchProposal(source: "driver")');
    expect(rerouteNeeded).toMatch(/maybeFetchProposal\(source: driverChannel \? "driver" : "auto"\)/);
  });

  it("복귀 문장은 이탈 문장을 실제로 게시한 회차에만 — 리듀서 spoken과 게시 기록 둘 다", () => {
    expect(backOnRoute).toMatch(/let say = \(spoken \|\| driverChannel\) && offRouteNoticePosted/);
    expect(backOnRoute).toMatch(/guard say else/);
    // 복귀가 재조회 버튼을 지워 커서가 움직이므로 기본 우선순위면 잠식된다(performReroute 성공 통지와 같은 기제).
    expect(backOnRoute).toMatch(/announce\(text, highPriority: true, speechClass: speechClass\)/);
  });

  it("이탈 문장 게시 기록은 게시 번호 집합이라 버려진 재통지가 들은 확정 문장의 기록을 지우지 않는다", () => {
    expect(beacon).toMatch(/private var offRouteNoticePosted: Bool \{ !offRouteNoticeLive\.isEmpty \}/);
    expect(beacon).toMatch(/announce\(text, speechClass: speechClass\) \{ \[weak self\] in self\?\.offRouteNoticeLive\.remove\(id\) \}/);
    expect(offRoute).not.toMatch(/offRouteNoticePosted = /);
  });

  it("운전자 채널은 보류 뒤 첫 발화(이미 말한 문장)를 건너뛴다", () => {
    expect(offRoute).toMatch(
      /if notice == \.renotify, firstSpoken, offRouteNoticePosted \{\s*logOffRouteNotice\([^)]*spoken: false\)\s*break\s*\}/,
    );
  });

  it("상태 행은 벗어난 쪽만이다 — 시계 방향은 음성으로만(위원장 판정 2026-10-04)", () => {
    expect(beacon).toMatch(/offRouteLine = driverChannel \? appLocalized\("guide\.carOffRoute"\) : GuideText\.offRouteSide\(side\)/);
  });

  it("자동 조회 진행 중 판정은 토큰 비교다 — 폐기된 옛 조회가 다음 회차를 막지 않는다", () => {
    expect(beacon).toMatch(/guard proposalInFlightToken != proposalToken else \{ return "inflight" \}/);
  });
});
