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
      taxiInStop: "자동차로 {stop}까지 {minutes}분, 택시 요금 약 {fare}원",
      arrivedStop: "{stop}에 도착했습니다.",
      clearStations: "갈아탈 역/정류장 지우기",
      recentRoute: "{from}에서 {to}까지, {station}역에서 갈아타기",
      recentRouteBoth: "{from}에서 {to}까지, {board}역과 {alight}역에서 갈아타기",
      egressNoneStop: "내린 정류장에서 자동차로 {minutes}분, 택시 요금 약 {fare}원",
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
      /announce\(\s*journeyBridge \? appLocalized\("ios\.journey\.accessFailedWith", appLocalized\(key\)\)\s*: prewalkBridge \?[^:]*: statusText,/,
    );
    // 다리 문장 키는 통지 인자에만 한 번 나온다(상태 줄 대입이 여러 줄이어도 잡는다)
    expect(fail.match(/accessFailedWith/g)).toHaveLength(1);
    const bridgeAt = fail.indexOf("accessFailedWith");
    expect(fail.lastIndexOf("announce(", bridgeAt)).toBeGreaterThan(fail.lastIndexOf("statusText =", bridgeAt));
    expect(fail).toContain("highPriority: highPriority || journeyBridge");
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
      /Button\(appLocalized\("ios\.journey\.clearStations"\)\) \{\s*submitFocused = true\s*model\.clearJourneyStations\(\)/,
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

describe("E70-e 정류장 지정 문구(spec §6)", () => {
  it("새 문장과 바뀐 notStation은 확정 문안 그대로다", () => {
    expect(KO.ios.journey).toMatchObject({
      notStation: "역이나 정류장을 골라 주세요.",
      busStopKind: "정류장",
      stopSearchFailed: "정류장을 불러오지 못했습니다.",
      stopSearchTruncated: "정류장 이름을 더 길게 입력해 주세요.",
      designatedHeadingBus: "{stop}에서 버스를 타는 경로",
      designatedHeadingBusAlight: "{stop}에서 버스에서 내리는 경로",
      designatedMissingStop: "{stop}에서 타는 경로를 찾지 못했습니다.",
      designatedMissingStopAlight: "{stop}에서 내리는 경로를 찾지 못했습니다.",
      recentRouteStop: "{from}에서 {to}까지, {stop}에서 갈아타기",
      recentRouteBothPlaces: "{from}에서 {to}까지, {board}, {alight}에서 갈아타기",
      stationPlace: "{station}역",
    });
  });
});

describe("E70-d 입력 메뉴 하나와 「자동차」 문장(위원장 판정 28~32, 2026-10-17)", () => {
  const tab = read("DirectionsTabView.swift");
  /** 폼의 갈아탈 역·경유지 입력 블록(경유지 행 ~ 조회 버튼). */
  const form = (() => {
    const start = tab.indexOf("if !isAboardOrigin, !showsStationFields, let viaName = viaFieldName {");
    const end = tab.indexOf("Button(submitText) { submitJourneyOrQuery() }", start);
    if (start < 0 || end < 0) throw new Error("길찾기 입력 블록을 찾지 못했다");
    return tab.slice(start, end);
  })();

  it("역 없는 최근 경로를 열면 이전 역을 비운다 — 남으면 조회가 조용히 여정으로 간다", () => {
    expect(tab).toMatch(
      /model\.setJourneyStations\(board: route\.boardStation, alight: route\.alightStation\)\s*\}\s*else if model\.hasJourneyStations \{\s*model\.clearJourneyStations\(\)/,
    );
  });

  it("판정 30·31: 여정 문장의 수단은 「자동차」이고 금액은 「택시 요금」이라고 밝힌다", () => {
    expect(KO.ios.journey).toMatchObject({
      addMenu: "경유지/자동차 환승 추가",
      addBoardStation: "자동차에서 내리는 역/정류장 추가",
      addAlightStation: "자동차를 탈 역/정류장 추가",
      boardField: "자동차에서 내리는 역/정류장",
      alightField: "자동차를 탈 역/정류장",
      taxiIn: "자동차로 {station}역까지 {minutes}분, 택시 요금 약 {fare}원",
      egressExit: "{exit}번 출구로 나가 자동차로 {minutes}분, 택시 요금 약 {fare}원",
      egressNone: "내린 역에서 자동차로 {minutes}분, 택시 요금 약 {fare}원",
      egressLookupFailed: "출구 정보를 불러오지 못했습니다. 내린 역에서 자동차로 {minutes}분, 택시 요금 약 {fare}원",
      taxiDropped: "자동차에서 내렸어요",
      taxiBoarded: "자동차에 탔어요",
      taxiOutFailed: "자동차 경로를 불러오지 못했습니다.",
      totals: "총 {minutes}분, 택시 요금 약 {taxiFare}원, 대중교통 요금 {transitFare}원",
    });
    // 판정 32: 승강장에서 타는 것은 택시다
    expect(KO.ios.journey.egressStand).toBe("택시 승강장에서 택시로 {minutes}분, 택시 요금 약 {fare}원");
    expect(KO.ios.journey.arrivedStand).toBe("택시 승강장에 도착했습니다.");
    expect(KO.ios.journey).not.toHaveProperty("toggle");
    // 「택시로」는 승강장 문장 하나에만 남는다
    const taxiRo = Object.entries(KO.ios.journey as Record<string, string>).filter(([, v]) => v.includes("택시로"));
    expect(taxiRo.map(([k]) => k)).toEqual(["egressStand"]);
  });

  it("판정 28: 경유지도 역도 없으면 메뉴 하나에 항목 셋이 이 순서다", () => {
    const menu = form.match(/Menu\(appLocalized\("ios\.journey\.addMenu"\)\) \{([\s\S]*?)\n\s*\}\n/);
    expect(menu).not.toBeNull();
    const items = [...menu![1].matchAll(/Button\(appLocalized\("([^"]+)"\)\) \{ searchTarget = \.(\w+) \}/g)].map((m) => [m[1], m[2]]);
    expect(items).toEqual([
      ["directions.addVia", "via"],
      ["ios.journey.addBoardStation", "boardStation"],
      ["ios.journey.addAlightStation", "alightStation"],
    ]);
    // 메뉴는 실험판·ko 조건 안에서만, 그 밖엔 종전 일반 「경유지 추가」 버튼이다
    expect(form).toMatch(
      /if journeyInputEnabled \{\s*\/\/[^\n]*\n\s*Menu\(appLocalized\("ios\.journey\.addMenu"\)\)[\s\S]*?\} else \{\s*Button\(appLocalized\("directions\.addVia"\)\) \{ searchTarget = \.via \}/,
    );
    expect(body(tab, "journeyInputEnabled")).toContain('AppConfig.experimentalJourneyEnabled && AppLanguage.dataLocale == "ko"');
    expect(body(tab, "showsStationFields")).toContain("journeyInputEnabled && model.hasJourneyStations");
  });

  it("판정 28: 칸은 역이 정해졌을 때만 생기고(빈 칸 없음), 남은 쪽은 일반 버튼 하나다", () => {
    expect(form).toContain("if model.boardStation != nil {\n                            Button { searchTarget = .boardStation }");
    expect(form).toContain("if model.alightStation != nil {\n                            Button { searchTarget = .alightStation }");
    expect(form).toMatch(
      /if model\.boardStation == nil \{\s*Button\(appLocalized\("ios\.journey\.addBoardStation"\)\) \{ searchTarget = \.boardStation \}\s*\} else if model\.alightStation == nil \{\s*Button\(appLocalized\("ios\.journey\.addAlightStation"\)\) \{ searchTarget = \.alightStation \}\s*\}/,
    );
    // 메뉴는 하나뿐이다(항목 하나짜리 메뉴를 만들지 않는다)
    expect(form.match(/Menu\(/g)).toHaveLength(1);
    // 빈 칸을 미리 펼치는 상태가 없다
    expect(tab).not.toMatch(/journeyExpanded|setJourneyExpanded|ios\.journey\.toggle/);
    // 역이 서면 경유지를 비운다(D14)
    expect(body(tab, "setJourneyStation")).toMatch(/via = nil/);
  });

  it("역이 정해지면 새로 생긴 그 칸에 착지하고, 칸을 지우면 남는 칸 또는 조회 버튼으로 선점한다", () => {
    const apply = body(tab, "applyResolvedFocus");
    expect(apply).toMatch(/target == \.boardStation \|\| target == \.alightStation \{\s*focusedEndpointField = target/);
    expect(body(tab, "landFocusAfterResolve")).toContain("case .boardStation, .alightStation: focusedEndpointField == target");
    const clear = body(tab, "clearStationField");
    // 선점은 모델 변경 전이다(칸이 사라지기 전에)
    expect(clear.indexOf("focusedEndpointField = remaining")).toBeLessThan(clear.indexOf("model.clearJourneyStation(board: board)"));
    expect(clear.indexOf("submitFocused = true")).toBeLessThan(clear.indexOf("model.clearJourneyStation(board: board)"));
  });
});
