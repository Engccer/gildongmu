import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// E80(정체 안내) 배선 가드. iOS 앱 타깃·웹 길찾기 화면은 이 계약을 단위 테스트로 밟지 못해(앱 타깃은 테스트 레인이
// 없고, 결과 화면 fetch는 통합 경로) 빠뜨려도 조용히 꺼진다 — 코드 리뷰 B1·B2·B3(변이가 살아남은 자리)를 소스로 잠근다.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const beacon = read("ios/Gildongmu/Directions/BeaconModel.swift");

describe("E80 배선 가드", () => {
  it("결과 화면은 정체를 옵트인한다(웹·iOS) — 빠지면 출발 전 정체 줄이 조용히 사라진다", () => {
    expect(read("src/components/DirectionsView.tsx")).toMatch(/\/api\/route\/car\?[^`]*&traffic=1/);
    expect(read("ios/Gildongmu/Directions/DirectionsTabView.swift")).toMatch(/service\.car\([^)]*traffic: true\)/);
  });

  it("웹 재조회 상수도 6분·10회·오래됨 420초(iOS carEta* 동조)", () => {
    const hook = read("src/hooks/useRouteGuide.ts");
    expect(hook).toMatch(/const CAR_ETA_INTERVAL_MS = 360_000;/);
    expect(hook).toMatch(/const CAR_ETA_CALL_CAP = 10;/);
    expect(hook).toMatch(/const CAR_ETA_STALE_S = 420;/);
  });

  it("「출발 지점부터」 문턱·브리핑 상한은 웹과 iOS가 같다", () => {
    const text = read("src/lib/car-traffic-text.ts");
    const ios = read("ios/Gildongmu/RouteBriefing.swift");
    expect(text).toContain("export const JAM_FROM_START_M = 100;");
    expect(ios).toContain("private let carJamFromStartMeters = 100");
    expect(text).toContain("export const BRIEFING_JAM_MAX = 3;");
    expect(ios).toContain("private let carBriefingJamMax = 3");
  });

  it("Kit 판정 상수는 웹과 같다", () => {
    const kit = read("ios/GildongmuKit/Sources/GildongmuKit/CarTrafficAhead.swift");
    expect(kit).toContain("public let carJamOnRouteMeters = 40.0");
    expect(kit).toContain("public let carJamLengthToleranceMeters = 150.0");
    expect(kit).toContain("public let carJamLengthToleranceRatio = 0.25");
  });

  it("iOS 재조회 상수는 6분·10회·오래됨 420초(웹 CAR_ETA_* 동조)", () => {
    expect(beacon).toContain("private static let carEtaIntervalSeconds = 360");
    expect(beacon).toContain("private static let carEtaCallCap = 10");
    expect(beacon).toContain("private static let carEtaStaleSeconds = 420.0");
    expect(beacon).toContain("Task.sleep(for: .seconds(Self.carEtaIntervalSeconds))");
    expect(beacon).toContain("guard etaCallCount < Self.carEtaCallCap else { return }");
    // 리터럴 잔재 금지(종전 600초·6회·660초).
    expect(beacon).not.toMatch(/\.seconds\(600\)|etaCallCount < 6\b|min\(6, etaCallCount|> 660\b/);
  });

  it("iOS 새 정체는 알린 하나를 아는 정체로 채택하고, 버려지면 되돌린다(같은 정체 반복 금지)", () => {
    const fn = beacon.match(/private func announceNewCarJam[\s\S]*?\n {4}\}\n/)?.[0] ?? "";
    expect(fn).toContain('briefing.provider == "tmap"');
    expect(fn).toContain("state.phase != .offRoute");
    expect(fn).toContain("deferredAnnouncer.hasPending || GuideSpeechOutput.speechBusy(deviceSpeech)");
    expect(fn).toMatch(/guard let nearest = out\.nearest, !busy/);
    expect(fn).toContain("knownCarJams = out.known");
    expect(fn).toContain("speechClass: .actionable");
    expect(fn).toMatch(/onDropped: \{[\s\S]*list\.remove\(at: i\)/);
    // 운전자 모드도 싣는다(위원장 판정 2026-11-07 ⑤) — 제외 가드를 되살리지 않는다.
    expect(fn).not.toContain("driverChannel");
  });

  it("웹 새 정체도 같은 네 규칙과 되돌리기를 지난다", () => {
    const hook = read("src/hooks/useRouteGuide.ts");
    const fn = hook.match(/const announceNewJam = useCallback\([\s\S]*?\n {2}\);\n/)?.[0] ?? "";
    expect(fn).toContain('briefing.provider === "tmap"');
    expect(fn).toContain('state.phase === "offRoute"');
    expect(fn).toContain("reannounceTimerRef.current !== null");
    expect(fn).toContain("knownJamsRef.current = out.known");
    expect(fn).toMatch(/announce\([\s\S]*filter\(\(k\) => k !== added\)/);
  });
});
