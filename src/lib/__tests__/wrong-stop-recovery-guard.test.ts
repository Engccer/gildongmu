import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E78 잘못 내림 복구 「여기서 다시 길찾기」의 배선 가드(spec `docs/superpowers/specs/2026-11-07-e78-wrong-stop-recovery-design.md`).
 * 판정(버튼 국면·출발점 방법·안내 가능 술어·후보 선택)은 Kit `TransitWrongStopRecoveryTests`가, 여기는 모델·시트 배선의
 * 게이트·무효화·순서를 잠근다 — 뷰·모델 계층은 테스트 레인이 없어 소스 가드가 유일한 검출 수단이다.
 */

const ROOT = join(__dirname, "../../..");
const DIR = join(ROOT, "ios/Gildongmu/Directions");
const read = (path: string) => readFileSync(path, "utf8");

function functionBody(source: string, name: string): string {
  const at = source.indexOf(`func ${name}(`);
  if (at < 0) throw new Error(`func ${name}을 찾지 못했다`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`func ${name}의 끝을 찾지 못했다`);
}

const model = () => read(join(DIR, "TransitGuideModel.swift"));
const sheet = () => read(join(DIR, "TransitTrackingSheet.swift"));

describe("E78 복구 — 모델", () => {
  it("버튼 국면은 Kit 판정 하나이고 여정 여부를 기본값 없이 넘긴다(§3.1·§5-3)", () => {
    expect(model()).toContain(
      "transitRecoveryOffered(phase: state.phase, inJourney: GuideSession.shared.journey != nil)",
    );
    expect(functionBody(model(), "beginRecovery")).toContain("transitRecoveryOrigin(leg)");
  });

  it("버스 출발점은 새 측위다 — 옛 좌표를 쓰지 않는다(§3.2 Q3)", () => {
    const body = functionBody(model(), "runRecovery");
    expect(body).toContain("LocationService.shared.currentCoordinate(force: true)");
    expect(body).toContain("transitRecoveryRoute(result)");
    // 조회는 누름당 한 번이고 0건과 안내 가능 0을 가른다(§8-2).
    expect(body.match(/fetchTransitCandidates\(/g)).toHaveLength(1);
    expect(body).toContain("outcome: .noRoute");
    expect(body).toContain("outcome: .noGuidable");
  });

  it("복구 중엔 폴(즉폴 포함)과 버스 하차 위치 통지가 멈춘다(§5-1)", () => {
    const poll = functionBody(model(), "restartPollLoop");
    expect(poll).toContain("if pendingRecovery != nil { return }");
    expect(poll.indexOf("if pendingRecovery != nil { return }")).toBeLessThan(poll.indexOf("idlePaused"));
    expect(functionBody(model(), "ingestKeepAliveFix")).toMatch(
      /if pendingRecovery == nil \{\s*let notice = transitBusAlightNoticeStep\(/,
    );
  });

  it("진입 때 옛 세션의 자동 통지 장부를 비운다(§8-5)", () => {
    const body = functionBody(model(), "quietForRecovery");
    for (const line of [
      "pollTask?.cancel()",
      "deferredAnnouncer.advanceGeneration()",
      "deviceSpeech.reset()",
      "missedAnnouncement = false",
      "droppedWhileSuppressed = nil",
    ]) {
      expect(body, line).toContain(line);
    }
    // 복귀 낭독은 복구 상태만 말한다.
    expect(functionBody(model(), "returnStatusText")).toMatch(
      /^\{\s*\/\/[^\n]*\n\s*if let pending = pendingRecovery \{ return recoveryStatusText\(pending\) \}/,
    );
  });

  it("사용자 조작·경쟁 커밋·종료가 복구 토큰을 먼저 무효화한다(§8-3)", () => {
    for (const name of ["beginReboard", "prepareDestinationChange", "prepareAltRoutes", "changeRoute", "stop"]) {
      expect(functionBody(model(), name), name).toContain("invalidateRecovery()");
    }
    expect(functionBody(model(), "dispatch")).toContain(
      "if userAction, invalidateRecovery() { restartPollLoop(immediate: true) }",
    );
  });

  it("커밋은 토큰·추적 중·경로 세대를 확인하고, 승차 전 도보가 있으면 도보부터 연다(§3.3·§8-1)", () => {
    const body = functionBody(model(), "commitRecovery");
    expect(body).toContain("pending.token == token, isTracking");
    expect(body).toContain("pending.routeGen == routeGen");
    // 국면 세대로는 버리지 않는다 — 누름 자체가 옛 위치 판단이 틀렸다는 선언이다.
    expect(body).not.toContain("phaseGen");
    const prewalk = body.indexOf("transitPrewalkTarget(guideRoute)");
    const handoff = body.indexOf("GuideSession.shared.transitTransferWalk(");
    const change = body.indexOf("changeRoute(transitRoute: route");
    expect(prewalk).toBeGreaterThan(-1);
    expect(prewalk).toBeLessThan(handoff);
    expect(handoff).toBeLessThan(change);
    expect(body).toContain('legIndex: 0, target: target');
    expect(body).toContain('lead: appLocalized("ios.transitGuide.routeSwitched")');
    expect(body).toContain("announcement: .routeSwitched");
  });

  it("경로 세대는 세션 시작과 경로 교체에서만 오른다", () => {
    expect(model().match(/routeGen \+= 1/g)).toHaveLength(2);
    expect(functionBody(model(), "changeRoute")).toContain("routeGen += 1");
  });
});

describe("E78 복구 — 시트", () => {
  it("버튼은 국면 버튼 다음이고 Kit 판정으로만 선다(§3.1 Q2)", () => {
    const body = functionBody(sheet(), "phaseControls");
    const reboard = body.indexOf('Button(appLocalized("transitGuide.changeBoarding"))');
    const recovery = body.indexOf("recoveryControls(leg: leg, proxy: proxy)");
    expect(reboard).toBeGreaterThan(-1);
    expect(recovery).toBeGreaterThan(reboard);
    expect(functionBody(sheet(), "recoveryControls")).toMatch(/^\{\s*if model\.recoveryOffered \{/);
  });

  it("역 목록 맨 끝에 「목록에 없는 역 찾기」, 그 뒤 취소다(§5-2)", () => {
    const picker = functionBody(sheet(), "stationPicker");
    const find = picker.indexOf('appLocalized("ios.transitGuide.recoveryFindStation")');
    const cancel = picker.indexOf("Button(appLocalized(reboardCancelKey))");
    expect(picker.indexOf("ForEach(")).toBeLessThan(find);
    expect(find).toBeLessThan(cancel);
    expect(sheet()).toContain("DirectionsEndpointSearchView(recoveryStation:");
  });

  it("걸어가기는 경로 없음·안내 가능 없음에만, 「다시 시도」는 실패에만 선다(§8-2)", () => {
    const body = functionBody(sheet(), "recoveryControls");
    expect(body).toMatch(/case \.noLocation, \.fetchFailed:\s*\/\/[^\n]*\n\s*Button\(appLocalized\("ios\.transitGuide\.recoveryRetry"\)\)/);
    expect(body).toMatch(/case \.noRoute, \.noGuidable:\s*Button\(appLocalized\("ios\.transitGuide\.recoveryWalk"\)\) \{ onWalkHandoff\?\(\) \}/);
  });
});
