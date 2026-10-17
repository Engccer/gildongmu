import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E70 여정 문안 판정(2026-10-17 위원장, BACKLOG E70 열린 판정 1~9 · spec §3.1 판정 19~27 · §8.4)의 앱 배선 가드.
 * 뷰·세션 조정자 계층은 테스트 레인이 없어 문장이 어느 자리에서 나가는지를 소스로 잠근다. 순수 판정(동명 이역 노선
 * 머리말과 그 쪽 선택·버스 정류장 끝)은 Kit `JourneyTests`·`JourneyModelsTests`가 맡는다.
 */

const ROOT = join(__dirname, "../../..");
const DIR = join(ROOT, "ios/Gildongmu/Directions");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const KO = JSON.parse(readFileSync(join(ROOT, "ios/i18n/ios-extra/ko.json"), "utf8"));
const MESSAGES_KO = JSON.parse(readFileSync(join(ROOT, "messages/ko.json"), "utf8"));

/** 주석을 지운 Swift 선언 본문(문자열 리터럴은 남긴다 — 키 이름을 보아야 한다). */
function body(source: string, name: string): string {
  const decl = new RegExp(`(?:var|func)\\s+${name}\\b`).exec(source);
  if (!decl) throw new Error(`Swift 선언 ${name}을 찾지 못했다`);
  const open = source.indexOf("{", decl.index);
  let depth = 0;
  let out = "";
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return out;
    out += c;
  }
  throw new Error(`Swift 선언 ${name}의 닫는 중괄호를 찾지 못했다`);
}

describe("E70 여정 확정 문장(위원장 판정 2026-10-17)", () => {
  it("새 문장은 판정 문안 그대로다", () => {
    expect(KO.ios.journey).toMatchObject({
      arrivedExit: "{exit}번 출구에 도착했습니다.",
      arrivedStand: "택시 승강장에 도착했습니다.",
      taxiInStop: "택시로 {stop}까지 {minutes}분, 약 {fare}원",
      arrivedStop: "{stop}에 도착했습니다.",
      clearStations: "갈아탈 역 지우기",
      recentRoute: "{from}에서 {to}까지, {station}역에서 갈아타기",
      recentRouteBoth: "{from}에서 {to}까지, {board}역과 {alight}역에서 갈아타기",
      egressNoneStop: "내린 정류장에서 택시로 {minutes}분, 약 {fare}원",
    });
  });

  it("판정 27: 접근 도보 시작 실패 틀은 「원인. 」 뒤에 승차 전 도보 다리 문장 그대로다", () => {
    expect(KO.ios.journey.accessFailedWith).toBe(`{reason}. ${MESSAGES_KO.transitGuide.prewalkUnavailable}`);
  });

  it("재사용하는 기존 문장(판정 4·6·9)은 그대로다", () => {
    expect(MESSAGES_KO.directions.readySummary).toBe("{count}개 수단의 경로 안내가 준비되었습니다.");
    expect(MESSAGES_KO.transitGuide.arrived).toBe("내리신 뒤 다음 구간 버튼을 눌러 주세요.");
    expect(MESSAGES_KO.transitGuide.advance).toBe("다음 구간");
    expect(MESSAGES_KO.transitGuide.prewalkUnavailable).toBe("도보 안내를 시작할 수 없어 승차 대기로 바로 넘어갑니다.");
  });
});

describe("E70 여정 문장의 자리", () => {
  const session = read("GuideSessionCoordinator.swift");

  it("판정 1: 출구 도보 도착은 출구·승강장 문장이다", () => {
    const stage = body(session, "startJourneyStage");
    const egress = stage.slice(stage.indexOf("case .egress"), stage.indexOf("case .taxiOut"));
    expect(egress).toContain('appLocalized("ios.journey.arrivedExit", option.label)');
    expect(egress).toContain('appLocalized("ios.journey.arrivedStand")');
  });

  it("판정 5: 버스로 시작하는 택시 앞 구간의 도착은 정류장 문장이다(기본 도착 문장으로 떨어지지 않는다)", () => {
    const stage = body(session, "startJourneyStage");
    expect(stage).toContain("plan.variant.boardsAtBusStop");
    expect(stage).toContain('appLocalized("ios.journey.arrivedStop", board.name)');
    expect(stage).not.toMatch(/atStop\s*\?\s*nil/);
    const rows = read("JourneyResultRows.swift");
    expect(rows).toMatch(/if variant\.boardsAtBusStop \{\s*Text\(appLocalized\("ios\.journey\.taxiInStop"/);
    // 버스로 끝나면 마지막 택시 줄도 정류장 문장(위원장 2026-10-17 judgment-202610171113 ②)
    expect(body(rows, "egressLine")).toMatch(
      /if variant\.alightsAtBusStop \{ return appLocalized\("ios\.journey\.egressNoneStop", minutes, fare\) \}/,
    );
  });

  it("판정 9: 접근 도보 시작 실패의 다리 문장은 도보 모델이 원인 문장과 한 통지로 내고, 대중교통 시작은 그 통지를 기다린다", () => {
    const beacon = read("BeaconModel.swift");
    const fail = body(beacon, "fail");
    expect(fail).toContain("let journeyBridge = starting && journeyChain?.bridgesStartFailure == true");
    // 통지에만 붙이고 상태 줄(길찾기 탭에 남는다)은 원인만
    expect(fail).toMatch(
      /announce\(\s*journeyBridge \? appLocalized\("ios\.journey\.accessFailedWith", appLocalized\(key\)\) : statusText,/,
    );
    expect(fail).not.toMatch(/statusText = [^\n]*accessFailedWith/);
    expect(body(beacon, "markChained")).toContain(
      "JourneyChainMark(arrivalText: arrivalText, bridgesStartFailure: bridgesStartFailure)",
    );
    const stage = body(session, "startJourneyStage");
    expect(stage).toContain("bridgesStartFailure: stage == .access");
    expect(stage.match(/bridgesStartFailure: false/g)).toHaveLength(3); // 출구 도보 세 갈래
    const advance = body(session, "advanceJourney");
    // 대중교통 창구로 따로 내지 않는다(세션 전이라 백그라운드에서 버려지고 원인 문장을 끊는다), 동기 거부엔 다리 문장이 없다
    expect(advance).not.toContain("announceExternal");
    expect(advance).not.toContain("prewalkUnavailable");
    expect(advance).toContain(
      "let accessBridged = !ignoreFailureCause && state.phase == .running(.access) && event == .stageEnded(.startFailed)",
    );
    expect(advance).toContain("waitsForWalkSpeech: accessBridged)");
    const prepare = body(session, "prepareJourneyStage");
    expect(prepare).toMatch(
      /if waitsForWalkSpeech, UIAccessibility\.isVoiceOverRunning \{[\s\S]*while !self\.beacon\.announcementsSettled, waited < Self\.walkSpeechWaitLimitMs/,
    );
    // 기다림은 `.prepared` 전이(대중교통 시작) 앞이다
    expect(prepare.indexOf("waitsForWalkSpeech, UIAccessibility")).toBeLessThan(prepare.indexOf("self.advanceJourney(.prepared(ready)"));
  });

  it("판정 6: 하차 역을 정한 여정의 하차 직후 버튼은 「다음 구간」이다", () => {
    const sheet = read("TransitTrackingSheet.swift");
    expect(body(sheet, "journeyHandoff")).toContain("handoffNow && model.journeyNextIsWalk != nil");
    expect(body(sheet, "advanceLabel")).toMatch(/journeyHandoff \|\| !handoffNow\s*\?\s*appLocalized\("transitGuide\.advance"\)/);
    expect(body(sheet, "phaseControls")).toMatch(/Button\(journeyHandoff\s*\?\s*appLocalized\("transitGuide\.advance"\)/);
    // 이 시트에서 「택시에 탔어요」는 더 나오지 않는다(출구 도보 단계·여정 시트의 버튼은 그대로)
    expect(sheet).not.toContain("ios.journey.taxiBoarded");
  });

  it("판정 8: 제목·못 찾음 줄이 동명 이역 노선 머리말을 거친다", () => {
    const rows = read("JourneyResultRows.swift");
    const heading = body(rows, "journeyVariantHeading");
    expect(heading).toContain("qualified ? journeyQualifiedStationName(name, line: line) : display(name)");
    expect(heading.match(/qualified: lines\.board\)/g)).toHaveLength(2); // 지정 역 제목 + 추천 제목
    expect(heading.match(/qualified: lines\.alight\)/g)).toHaveLength(2);
    const missing = body(rows, "missingLines");
    expect(missing).toContain("lines.board ? journeyQualifiedStationName($0.label, line: $0.line)");
    expect(missing).toContain("lines.alight ? journeyQualifiedStationName($0.label, line: $0.line)");
    // 쪽 판정은 Kit(`journeyLineQualifiers`·`journeyRecommendedTitleIsBoardSide`, 테스트 `JourneyTests`) 한 곳이다
    expect(rows).not.toMatch(/func journeyLineQualifiers|struct JourneyLineQualifiers/);
    expect(body(rows, "lines")).toContain("journeyLineQualifiers(result, board: board, alight: alight)");
    expect(heading).toContain("journeyRecommendedTitleIsBoardSide(v, board: board, alight: alight, lines: lines)");
    // 선택 버튼·제목·안내 시작 버튼이 같은 한정자로 같은 이름을 말한다
    expect(rows.match(/journeyVariantHeading\(/g)).toHaveLength(2); // 정의 + `heading(_:)` 한 자리
  });

  it("판정 3: 「갈아탈 역 지우기」는 두 칸을 접어 비우고 조회 버튼으로 커서를 선점한다", () => {
    const tab = read("DirectionsTabView.swift");
    expect(tab).toMatch(
      /Button\(appLocalized\("ios\.journey\.clearStations"\)\) \{\s*submitFocused = true\s*model\.setJourneyExpanded\(false\)/,
    );
  });

  it("판정 2: 최근 경로 줄은 여정이면 짧은 여정 문장이고, 활성화가 역을 쓰는 조건에서만이다", () => {
    const tab = read("DirectionsTabView.swift");
    expect(body(tab, "recentRouteLabel")).toContain("if let journey = recentJourneyLabel(route, from: from, to: to) { return journey }");
    const line = body(tab, "recentJourneyLabel");
    const gate = 'AppConfig.experimentalJourneyEnabled, AppLanguage.dataLocale == "ko"';
    expect(line).toContain(`guard ${gate} else { return nil }`);
    expect(body(tab, "activateRecentRoute")).toContain(gate);
    expect(line).toContain('"ios.journey.recentRouteBoth", from, to, board, alight');
    expect(line).toContain('"ios.journey.recentRoute", from, to, $0');
  });
});
