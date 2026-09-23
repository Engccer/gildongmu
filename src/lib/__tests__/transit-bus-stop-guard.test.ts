import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E48(spec 2026-09-23 bus-current-stop) 표시 전용 계약과 위치 스토어 불변식의 2선(1선은 구조 — 기기 위치 상태가
 * 리듀서 밖에 있고, keep-alive fix는 싱크로만 나간다). iOS 앱 타깃은 테스트 레인이 없어 배선을 소스로 잠근다.
 */
const ROOT = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("버스 현재 정류장은 표시 전용이다(E48)", () => {
  it("승차 상태 머신·기존 조망 판정은 기기 위치 모듈을 모른다", () => {
    for (const rel of [
      "src/lib/transit-guide.ts",
      "ios/GildongmuKit/Sources/GildongmuKit/TransitGuide.swift",
      "src/lib/transit-progress-overview.ts",
      "ios/GildongmuKit/Sources/GildongmuKit/TransitProgressOverview.swift",
      "ios/GildongmuKit/Sources/GildongmuKit/TransitSurroundingsAnchor.swift",
    ]) {
      expect(read(rel), rel).not.toMatch(/BusStop|busStop|bus-stop|DeviceFix/);
    }
  });
});

describe("keep-alive fix는 안내 세션만 읽는다(E48 §4.1)", () => {
  const src = read("ios/Gildongmu/LocationService.swift");

  it("keep-alive 단독 fix는 여전히 공유 스토어에 쓰지 않는다(E36 §4.2.3 ⓐ)", () => {
    expect(src).toMatch(/if storable, !self\.isKeepAliveOnly \{/);
  });

  it("싱크는 keep-alive가 열린 동안, 정밀 위치 세션의 fix만 받는다", () => {
    expect(src).toMatch(/if self\.isKeepAliveActive, isPrecise \{\s*self\.keepAliveFixSink\?\(payload\)/);
  });

  it("keep-alive를 끄면 버스 프로파일·싱크가 함께 풀린다(다음 세션이 정밀로 시작하지 않게)", () => {
    const stop = src.slice(src.indexOf("func stopKeepAliveUpdates()"));
    const guard = stop.indexOf("guard isKeepAliveActive");
    expect(stop.indexOf("keepAliveBusRiding = false")).toBeLessThan(guard);
    expect(stop.indexOf("keepAliveFixSink = nil")).toBeLessThan(guard);
  });

  it("모델: 버스 riding일 때만 정밀 프로파일, 세션 경계에서 표시 상태를 비운다", () => {
    const model = read("ios/Gildongmu/Directions/TransitGuideModel.swift");
    // 켜는 조건은 표식의 적용 조건 그 자체다(구현 리뷰 m4).
    expect(model).toMatch(/transitBusStopApplies\(state: state, leg: leg\)\s*\} else \{\s*false\s*\}\s*if keepAliveActive \{/);
    // 정상 흐름(boarding에서 켜진 keep-alive를 riding에서 올린다, A46)은 이미 켜진 분기다 — 그 안에서 반영해야 한다(구현 리뷰 m1).
    const on = model.slice(model.indexOf("if keepAliveActive {"));
    const branch = on.slice(0, on.indexOf("return\n"));
    expect(branch).toMatch(/LocationService\.shared\.setKeepAliveBusRiding\(busRiding\)/);
    expect(model.match(/setKeepAliveBusRiding\(busRiding\)/g)?.length).toBe(2);
    // beginSession·changeRoute·stop(E35 `ridingPosition`을 비우는 세 자리) + 유휴 진입(설계 리뷰 M4).
    expect(model.match(/^\s*clearBusStop\(\)/gm)?.length).toBe(4);
    const idle = model.slice(model.indexOf("private func enterIdleIfDue()"), model.indexOf("private func updateKeepAlive()"));
    expect(idle, "유휴 정지는 표식을 비워야 한다 — fix도 만료 판정도 오지 않는다").toMatch(/clearBusStop\(\)/);
    // 뷰는 표식만 읽는다(추적 상태는 fix마다 바뀐다 — 관측 밖).
    expect(model).toMatch(/@ObservationIgnored private var busStopTracker: TransitBusStopTracker\?/);
  });

  it("버스 프로파일 대입은 applyProfile 한 곳뿐이다(설계 리뷰 m6 — 프로파일 분기가 두 곳으로 갈라지지 않게)", () => {
    expect(src.match(/kCLLocationAccuracyNearestTenMeters/g)?.length).toBe(1);
    const profile = src.slice(src.indexOf("private func applyProfile("), src.indexOf("func startKeepAliveUpdates()"));
    expect(profile).toMatch(/if keepAliveBusRiding \{/);
  });
});

describe("웹 스트림은 iOS keep-alive와 같은 조건에서만 열린다(접근성 감사 MINOR-1)", () => {
  it("폴이 도는 버스 riding에서만 — 비관측 잠금·추적 불가 구간은 두 플랫폼 모두 표식이 없다", () => {
    const hook = read("src/hooks/useTransitGuide.ts");
    expect(hook).toMatch(/busStopApplies\(state, activeRoute\.legs\[state\.legIndex\]\) &&\s*pollIntervalMs\(state\) > 0;/);
  });
});
