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
      expect(read(rel), rel).not.toMatch(/BusStop|busStop|bus-stop|DeviceFix|AlightNotice/);
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
    const fn = model.slice(model.indexOf("private func updateKeepAlive()"));
    const on = fn.slice(fn.indexOf("if keepAliveActive {"));
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

describe("하차 정류장 도착 한 마디는 표시 전용 계약의 의도된 예외 하나다(A69 spec 2026-10-19 §2.3)", () => {
  const hook = read("src/hooks/useTransitGuide.ts");
  const model = read("ios/Gildongmu/Directions/TransitGuideModel.swift");

  it("판정을 부르는 자리는 플랫폼마다 한 곳이고, 그 자리는 리듀서 입력을 만들지 않는다", () => {
    expect(hook.match(/busAlightNoticeStep\(/g)?.length).toBe(1);
    const watch = hook.slice(hook.indexOf("navigator.geolocation.watchPosition("));
    const callback = watch.slice(0, watch.indexOf("enableHighAccuracy"));
    expect(callback).toMatch(/busAlightNoticeStep\(/);
    expect(callback).not.toMatch(/dispatch\(|commit\(/);
    // 기록 저장과 발화 배선 — 지우면 기능이 조용히 사라진다(구현 리뷰 m3).
    expect(callback).toMatch(/busAlightNoticeRef\.current = notice\.notice;\s*if \(notice\.speak\) announceAlightReached\(leg\);/);

    expect(model.match(/transitBusAlightNoticeStep\(/g)?.length).toBe(1);
    const ingest = model.slice(
      model.indexOf("private func ingestKeepAliveFix("),
      model.indexOf("private func announceAlightReached("),
    );
    expect(ingest).toMatch(/transitBusAlightNoticeStep\(/);
    expect(ingest).not.toMatch(/dispatch\(/);
    expect(ingest).toMatch(/busAlightNotice = notice\.notice\s*if notice\.speak \{ announceAlightReached\(leg: leg, legIndex: state\.legIndex, phaseGen: state\.phaseGen\) \}/);
  });

  it("관측 이력이 선 구간의 늦은 「다음 정류장」은 내지 않는다(웹·iOS)", () => {
    expect(hook).toMatch(/case "arrivingAtAlightStop": \{[\s\S]{0,700}?notice\?\.reached && notice\.legIndex === cur\?\.legIndex && notice\.phaseGen === cur\.phaseGen\) break;/);
    // iOS는 handle(event:) 앞에서 거른다 — 이벤트 톤(`transitEventProfile`)도 함께 나가지 않게.
    expect(model).toMatch(/if case \.arrivingAtAlightStop = event, let notice = busAlightNotice, notice\.reached,\s*notice\.legIndex == result\.state\.legIndex, notice\.phaseGen == result\.state\.phaseGen \{/);
  });

  it("iOS: 도착 톤은 백그라운드 불허, 행동 문장, 버려지면 전달 장부만 되돌린다(관측 이력은 남긴다)", () => {
    const fn = model.slice(model.indexOf("private func announceAlightReached("), model.indexOf("// MARK: - 사용자 액션"));
    expect(fn).toMatch(/playTone\(\.nearby, allowedInBackground: false\)/);
    expect(fn).toMatch(/deferredAnnouncer\.announce\(text, highPriority: true, speechClass: \.actionable\) \{/);
    expect(fn).toMatch(/self\.busAlightNotice\?\.announced = false/);
    // 재시도 소유자는 다음 적격 fix 하나 — 일반 억제 복구가 위치 재검증 없이 재생하지 않게(설계 리뷰 2차).
    expect(fn).toMatch(/if self\.droppedWhileSuppressed\?\.text == text \{ self\.droppedWhileSuppressed = nil \}/);
    // 백그라운드 버림은 복귀 낭독이 갚는다 — 되돌리지 않는다(a11y 감사 M2).
    expect(fn).toMatch(/guard GuideSpeechOutput\.isForeground, let notice = self\.busAlightNotice,\s*notice\.legIndex == legIndex, notice\.phaseGen == phaseGen else \{ return \}/);
    expect(fn).not.toMatch(/reached = false/);
  });

  it("기록 수명: 세션 시작·경로 변경·종료 세 자리에서 비우고 유휴 진입은 비우지 않는다", () => {
    expect(model.match(/^\s*busAlightNotice = nil/gm)?.length).toBe(3);
    const idle = model.slice(model.indexOf("private func enterIdleIfDue()"), model.indexOf("private func updateKeepAlive()"));
    expect(idle).not.toMatch(/busAlightNotice = nil/);
    expect(hook.match(/busAlightNoticeRef\.current = null;/g)?.length).toBe(2);
  });
});
