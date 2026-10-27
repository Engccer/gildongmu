import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E71 「지금 탄 열차에서 여정 시작」의 안내 쪽 소스 가드
 * (spec `docs/superpowers/specs/2026-10-27-e71-riding-start-design.md` R8·R9·R10·R14).
 *
 * `aboard`는 안전 인자라 기본값이 없어야 하고(생략이 컴파일을 통과해 조용히 종전 대기 시작이 된다), 방향 잠금은
 * 후보 분류 입력과 `boardAboard` 재확인 두 자리가 함께 서야 한다(한쪽만 있으면 반대 방향 열차로 식별 잠금이 선다).
 * 둘 다 오류 없이 어긋나므로 소스로 잠근다.
 */

const DIR = join(__dirname, "../../../ios/Gildongmu/Directions");
const MODEL = readFileSync(join(DIR, "TransitGuideModel.swift"), "utf8");
const COORD = readFileSync(join(DIR, "GuideSessionCoordinator.swift"), "utf8");
const SHEET = readFileSync(join(DIR, "TransitTrackingSheet.swift"), "utf8");
const TAB = readFileSync(join(DIR, "DirectionsTabView.swift"), "utf8");
const ENDPOINT = readFileSync(join(DIR, "DirectionsEndpointSearchView.swift"), "utf8");
const KO = JSON.parse(readFileSync(join(__dirname, "../../../ios/i18n/ios-extra/ko.json"), "utf8")) as {
  ios: { journey: Record<string, string> };
};

/** 선언 시그니처(여는 중괄호 앞까지). */
function signature(source: string, head: string): string {
  const at = source.indexOf(head);
  if (at < 0) throw new Error(`Swift 선언 ${head}을 찾지 못했다`);
  return source.slice(at, source.indexOf("{", at));
}

/** 선언 본문(주석 제거). 중괄호를 세어 닫는 자리까지. */
function body(source: string, head: string): string {
  const at = source.indexOf(head);
  if (at < 0) throw new Error(`Swift 선언 ${head}을 찾지 못했다`);
  const open = source.indexOf("{", at);
  let depth = 0;
  let out = "";
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += c;
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return out;
  }
  throw new Error(`Swift 선언 ${head}의 닫는 중괄호를 찾지 못했다`);
}

describe("E71 aboard 시작 — 안전 인자(R10)", () => {
  it("TransitGuideModel.start·beginSession·beginTransit 시그니처의 aboard에 기본값이 없다", () => {
    for (const [src, head] of [
      [MODEL, "func start("],
      [MODEL, "private func beginSession("],
      [COORD, "private func beginTransit("],
    ] as const) {
      const sig = signature(src, head);
      expect(sig, `${head} 시그니처에 aboard 인자가 없다`).toContain("aboard: TransitAboardStart?");
      expect(sig, `${head}의 aboard에 기본값이 붙었다`).not.toContain("aboard: TransitAboardStart? =");
    }
  });

  it("JourneyPlan.aboard는 저장 프로퍼티다", () => {
    expect(body(COORD, "struct JourneyPlan")).toContain("let aboard: TransitAboardStart?");
  });

  it("호출 자리가 aboard를 명시한다 — startTransit·startAfterPrewalk는 nil, 여정 대중교통 단계는 plan.aboard", () => {
    expect(body(COORD, "func startTransit(")).toContain("aboard: nil");
    expect(body(MODEL, "func startAfterPrewalk(")).toContain("aboard: nil");
    expect(body(COORD, "func startJourneyStage(")).toContain("aboard: plan.aboard");
  });

  it("beginTransit은 aboard 시작이면 승차 전 도보 판정을 건너뛰고 모델에 aboard를 싣는다", () => {
    const b = body(COORD, "private func beginTransit(");
    expect(b).toMatch(/aboard == nil[\s\S]{0,80}transitPrewalkTarget\(guideRoute\)/);
    expect(b).toContain("aboard: aboard");
  });
});

describe("E71 aboard 시작 — 방향 잠금(R14)", () => {
  it("후보 풀이 journeyAboardTrainItems를 지난다", () => {
    expect(body(MODEL, "func waitingCandidatesPool(")).toContain("journeyAboardTrainItems(");
  });

  it("boardAboard가 고른 방향과 열차 방향을 다시 비교한다", () => {
    const b = body(MODEL, "func boardAboard(item:");
    expect(b).toContain("aboardDirection");
    expect(b).toContain("item.direction");
  });

  it("잠금은 riding 진입·도착 선언·경로 교체·세션 종료에서 풀린다", () => {
    for (const head of ["func stop(", "func declareArrived(", "private func changeRoute("]) {
      expect(body(MODEL, head), `${head}에 aboardDirection 해제가 없다`).toMatch(/aboardDirection = nil/);
    }
    expect(MODEL).toMatch(/if result\.state\.phase != \.waiting \{[^}]*aboardDirection = nil/);
    expect(MODEL).toMatch(/case \.advance:[^\n]*aboardDirection = nil/);
  });
});

describe("E71 aboard 시작 — 통지와 착지(R8·R9)", () => {
  it("aboard 시작이면 시작 통지에 대기 문맥(waitContextText)을 붙이지 않는다", () => {
    const b = body(MODEL, "private func beginSession(");
    expect(b).toMatch(/if !aboardStarted \{\s*parts\.append\(waitContextText\(first, isCurrentLeg: true\)\)/);
  });

  it("시트 첫 착지는 aboard 시작의 일회성 표식이 설 때만 질문 라벨, 아니면 상태 문장 한 줄이다(E38 — 띠바 복귀·일반 A34는 상태 문장)", () => {
    const line = ".task { landControlFocus(model.consumeAboardStartLanding() && controlExists(.waitingLabel) ? .waitingLabel : .status, proxy: proxy) }";
    expect(SHEET.includes(line), "시트 열림 착지 한 줄이 없다").toBe(true);
    expect(SHEET).not.toMatch(/landControlFocus\(model\.aboardStep/);
  });

  it("착지 표식은 aboard 시작에서만 서고 소비 메서드가 되돌리며 방향 잠금을 푸는 자리에서 함께 풀린다", () => {
    expect(body(MODEL, "private func beginSession(")).toMatch(/aboardStartLandingPending = true/);
    expect(MODEL.match(/aboardStartLandingPending = true/g)?.length, "표식을 세우는 자리는 beginSession 하나다").toBe(1);
    const consume = body(MODEL, "func consumeAboardStartLanding(");
    expect(consume).toContain("defer { aboardStartLandingPending = false }");
    expect(consume).toContain("return aboardStartLandingPending");
    for (const head of ["func stop(", "func declareArrived(", "private func changeRoute("]) {
      expect(body(MODEL, head), `${head}에 표식 해제가 없다`).toMatch(/aboardStartLandingPending = false/);
    }
    expect(MODEL).toMatch(/if result\.state\.phase != \.waiting \{[^}]*aboardStartLandingPending = false/);
  });
});

describe("E71 aboard 출발 — 길찾기 화면(spec §5·R11·R12)", () => {
  it("출발지 시트의 aboardStart 행은 콜백이 있을 때만 서고 길찾기 탭은 journeyInputEnabled일 때만 그 콜백을 넘긴다", () => {
    expect(ENDPOINT).toMatch(/if target == \.from, onSelectAboardStation != nil[^{]*\{[\s\S]{0,400}ios\.journey\.aboardStart/);
    expect(TAB).toMatch(/onSelectAboardStation: journeyInputEnabled \? \{/);
    expect(TAB.match(/onSelectAboardStation:/g)?.length, "길찾기 탭의 시트 호출은 하나다").toBe(1);
  });

  it("onSelectAboardStation은 기본값이 없다(역 init 선언의 필수 인자)", () => {
    const sig = signature(ENDPOINT, "init(\n        target: DirectionsFieldTarget, onSelect: @escaping (DirectionsEndpoint) -> Void,\n        onSelectStation");
    expect(sig).toContain("onSelectAboardStation: ((RecentStation) -> Void)?");
    expect(sig).not.toContain("onSelectAboardStation: ((RecentStation) -> Void)? =");
  });

  it("시트는 aboard 모드에서 지하철역(.subway)만 받고 아니면 aboardNotSubway 통지다(역 칸의 notStation은 정류장도 받는다는 뜻)", () => {
    const b = body(ENDPOINT, "private func selectAboardStation(");
    expect(b).toContain("stationLayoutKind(place) == .subway");
    expect(b).toContain("ios.journey.aboardNotSubway");
    expect(b).not.toContain("ios.journey.notStation");
    expect(b).toContain("kind: nil");
  });

  it("performJourney는 aboard 결과를 최근 경로에 저장하지 않는다(R11)", () => {
    const b = body(TAB, "private func performJourney(");
    expect(b).toMatch(/if aboardOrigin == nil \{\s*recordRecentRoute\(/);
    expect(b.match(/recordRecentRoute\(/g)?.length, "저장 자리는 하나다").toBe(1);
  });

  it("performJourney의 승차 쪽 질의는 aboard면 고른 방향을 싣는다", () => {
    const b = body(TAB, "private func performJourney(");
    expect(b).toMatch(/aboardDirection: a\.direction\?\.direction/);
  });

  it("setEndpoint는 출발지 확정에서 aboard를 지운다(R12)", () => {
    const b = body(TAB, "func setEndpoint(");
    expect(b).toMatch(/case \.from:[^\n]*clearAboard\(\)/);
  });

  it("출발지가 aboard면 바꾸기·경유지·역 A 항목이 숨는다", () => {
    expect(body(TAB, "func swap(")).toContain("aboardOrigin == nil");
    expect(TAB).toMatch(/Button\(appLocalized\("directions\.swap"\)\)[\s\S]{0,80}model\.swap\(\)/);
    expect(TAB).toMatch(/if model\.aboardOrigin == nil \{\s*Button\(appLocalized\("directions\.swap"\)\)/);
  });

  it("aboard 결과의 안내 시작 버튼은 이름 없는 beacon.start다(제목의 「타는 경로」가 이미 탄 사람에게 거짓)", () => {
    const rows = readFileSync(join(DIR, "JourneyResultRows.swift"), "utf8");
    expect(rows).toContain('Button(aboard ? appLocalized("beacon.start") : appLocalized("beacon.guideStartTransitAlt", heading(variant)))');
  });

  it("역 B 칸은 헬퍼 하나를 두 분기가 쓰고 헬퍼가 밀기 삭제를 든다", () => {
    expect(TAB.match(/\n\s*alightStationRow\n/g)?.length).toBe(2);
    expect(body(TAB, "private var alightStationRow")).toContain("clearStationField(board: false)");
  });

  it("aboard 시작 행은 사라지기 전에 마이크 행을 선점하고 검색 필드 착지는 경합 바인딩을 먼저 놓는다", () => {
    expect(ENDPOINT).toMatch(/Button\(appLocalized\("ios\.journey\.aboardStart"\)\) \{\s*micRowFocused = true/);
    const land = body(ENDPOINT, "private func landAboardSearchField(");
    expect(land).toMatch(/searchFieldFocused = false[\s\S]*searchFieldFocused = true/);
  });

  it("방면 조회 도착은 착지 중·검색 시트가 떠 있는 동안 표식만 남기고, 처리할 때 모델의 지금 상태를 다시 읽는다", () => {
    const arrive = body(TAB, "private func handleAboardArrival(");
    expect(arrive).toMatch(/if aboardLandingPending \{[\s\S]*?afterAssignment: aboardLandingAssigned[\s\S]*?return\s*\}/);
    // 검색 시트(받아쓰기)가 떠 있는 동안은 통지·진동이 없다(헌장 §6 녹음 중 발화 0)
    expect(arrive).toMatch(/if searchTarget != nil \{[\s\S]*?return\s*\}/);
    expect(arrive.indexOf("searchTarget != nil")).toBeLessThan(arrive.indexOf("settleAboardArrival("));
    // 보류 칸은 상태 값을 들지 않는다(지운 뒤·바꾼 뒤 옛 결과를 처리하지 않게)
    expect(TAB).not.toContain("aboardArrivalAfterLanding");
    expect(TAB).toMatch(/@State private var aboardDeferredArrival: AboardDeferredArrival\?/);
    expect(body(TAB, "private struct AboardDeferredArrival")).toContain("let station: RecentStation");
    const settle = body(TAB, "private func settleAboardArrival(");
    expect(settle).toMatch(/let state = model\.aboardDirectionsState/);
    expect(settle).toMatch(/guard state != \.idle, state != \.loading else \{ return \}/);
    expect(settle).toMatch(/if aboardStepFocused \{[\s\S]*rereadAboardStep\(\)[\s\S]*\} else if let sentence \{[\s\S]*Announcement/);
    expect(TAB).toMatch(/\.onChange\(of: model\.aboardDirectionsState\) \{ old, new in\s*guard old == \.loading, new != \.idle, new != \.loading else \{ return \}\s*handleAboardArrival\(\)/);
  });

  it("착지는 세대 토큰으로 겹침을 막고, 끝에서 역 정체성을 확인하며, 재시도 대입이 커서를 옮겼으면 다시 읽지 않는다", () => {
    const begin = body(TAB, "private func beginAboardLanding(");
    expect(begin).toMatch(/aboardLandingGeneration \+= 1/);
    expect(begin).toContain("aboardLandingPending = true");
    expect(begin).toContain("aboardDeferredArrival = nil");
    expect(TAB).toMatch(/onSelectAboardStation: journeyInputEnabled \? \{ station in[\s\S]{0,300}beginAboardLanding\(\)/);
    const land = body(TAB, "private func landAboardStepFocus(");
    expect(land.match(/guard generation == aboardLandingGeneration else \{ return \}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(land).toMatch(/let station = model\.aboardOrigin\?\.station/);
    expect(land).toMatch(/deferred\.station == station, model\.aboardOrigin\?\.station == station/);
    // 재시도 대입은 지금 라벨을 읽으므로 그 전에 도착한 결과를 다시 읽기 대상에서 뺀다
    expect(land).toMatch(/if retried \{\s*aboardStepFocused = true\s*aboardDeferredArrival\?\.afterAssignment = false/);
    expect(land).toMatch(/aboardLandingPending = false[\s\S]*settleAboardArrival\(rereadIfFocused: deferred\.afterAssignment\)/);
    // 착지 끝에 시트가 떠 있으면 시트가 닫힐 때로 넘긴다
    expect(land).toMatch(/guard searchTarget == nil else \{ return \}/);
    // 시트가 닫히면 보류한 결과를 처리한다
    expect(TAB).toMatch(/\.onChange\(of: searchTarget\) \{[\s\S]{0,900}settleAboardArrivalAfterSheet\(\)/);
    const after = body(TAB, "private func settleAboardArrivalAfterSheet(");
    expect(after).toMatch(/model\.aboardOrigin\?\.station == deferred\.station/);
    expect(after).toContain("settleAboardArrival(rereadIfFocused: true)");
  });

  it("노선 버튼은 선점 대입만 하고, 로딩 중 이탈은 실패가 아니라 미완료로 두고 돌아오면 재조회한다", () => {
    // 노선 버튼은 선점 대입만 한다(같은 트랜잭션의 다시 읽기는 선점을 무효화한다)
    expect(TAB).toMatch(/aboardStepFocused = true\s*model\.chooseAboardLine\(line\)\s*\}/);
    expect(body(TAB, "private func commitAboardState(")).not.toMatch(/Announcement/);
    const cancel = body(TAB, "func cancel()");
    expect(cancel).toMatch(/aboardDirectionsState == \.loading \{[\s\S]*aboardDirectionsState = \.idle/);
    expect(body(TAB, "func resumeAboardDirections(")).toContain("loadAboardDirections()");
    expect(TAB).toMatch(/model\.resumeAboardDirections\(\)\s*await model\.loadCurrentAddressIfAuthorized\(\)/);
  });

  it("오는 열차 없음도 실패처럼 새로고침 버튼이 있다(열차는 잠시 뒤 올 수 있다)", () => {
    const rows = body(TAB, "private var aboardStepRows");
    expect(rows).toMatch(/case \.failed, \.loaded:\s*Button\(appLocalized\("ios\.common\.refresh"\)\) \{\s*aboardStepFocused = true\s*model\.retryAboardDirections\(\)/);
    expect(body(TAB, "func retryAboardDirections(")).toMatch(/aboardDirectionsState == \.failed \|\| aboardDirectionsState == \.loaded\(\[\]\)/);
  });

  it("여정 입력이 사라지면 aboard를 지우고, 조회는 aboard인데 여정 조건이 아니면 일반 조회로 떨어지지 않는다(R11)", () => {
    expect(TAB).toMatch(/\.onChange\(of: journeyInputEnabled\) \{ _, enabled in\s*if !enabled \{ model\.clearAboard\(\) \}/);
    expect(body(TAB, "private func performQuery(")).toMatch(
      /if aboardOrigin != nil, !\(AppConfig\.experimentalJourneyEnabled && AppLanguage\.dataLocale == "ko"\) \{\s*phase = \.idle\s*return\s*\}/,
    );
  });

  it("JourneyPlan 생성부가 aboard를 고른 방향에서 만든다", () => {
    const at = TAB.indexOf("JourneyPlan(");
    expect(at).toBeGreaterThan(0);
    expect(TAB.slice(at, at + 400)).toMatch(/aboard: model\.aboardOrigin\?\.direction\.map \{ TransitAboardStart\(direction: \$0\.direction\) \}/);
    expect(TAB).not.toContain("aboard: nil");
  });

  it("방면 전 조회 버튼은 조회하지 않고 단계 줄로 커서를 옮긴다", () => {
    const b = body(TAB, "private func submitJourneyOrQuery(");
    expect(b).toMatch(/guard model\.aboardNeedsDirection else \{\s*model\.runQuery\(\)\s*return\s*\}\s*aboardStepFocused = true/);
    // 커서가 옮겨 간 줄의 라벨이 같은 문장이라 통지를 겹치지 않는다(.high는 착지 라벨로 대체될 수 없을 때만)
    expect(b).not.toMatch(/Announcement|accessibilitySpeechAnnouncementPriority/);
    expect(body(TAB, "func runQuery(")).toContain("aboardNeedsDirection");
  });
});

/** spec §7 표(ko). 한 글자도 다르면 낭독 계약이 바뀐 것이다. */
const ABOARD_KO: Record<string, string> = {
  aboardStart: "지하철역 검색",
  aboardStationField: "현재 정차 중인 역 또는 다음 역 검색",
  aboardField: "지금 탄 열차, {station}",
  aboardFieldDirection: "지금 탄 열차, {station}, {direction}",
  aboardLinePrompt: "어느 노선인가요?",
  aboardDirectionPrompt: "어느 방면 열차인가요?",
  aboardNotSubway: "지하철역을 골라 주세요.",
  aboardDirectionRow: "{direction}, {terminals}",
  aboardTerminal: "{name}행",
  aboardDirectionsLoading: "열차 정보를 불러오는 중입니다.",
  aboardDirectionsEmpty: "지금 이 역에 오는 열차가 조회되지 않습니다.",
  aboardDirectionsUnavailable: "이 역은 실시간 열차 정보가 없어 지금 탄 열차에서 출발할 수 없습니다.",
  aboardDirectionsFailed: "열차 정보를 불러오지 못했습니다.",
  aboardMissing: "지금 탄 열차로 가는 경로를 찾지 못했습니다.",
  aboardOpposite: "지금 탄 열차는 목적지 반대 방향으로 갑니다.",
  totalsAboard: "총 {minutes}분",
  totalsAboardTaxi: "총 {minutes}분, 택시 요금 약 {taxiFare}원",
};

describe("E71 aboard 출발 — 표시·낭독 문장(spec §7)", () => {
  it("키 17개가 ko.json에 spec 문장 그대로 있다", () => {
    expect(Object.keys(ABOARD_KO)).toHaveLength(17);
    for (const [key, text] of Object.entries(ABOARD_KO)) {
      expect(KO.ios.journey[key], `ios.journey.${key}`).toBe(text);
    }
  });

  it("그 문장들에 가운뎃점·em dash가 없다", () => {
    for (const [key, text] of Object.entries(ABOARD_KO)) {
      expect(KO.ios.journey[key], key).not.toMatch(/[·\u2014\u2013]/);
      expect(text).not.toMatch(/[·\u2014\u2013]/);
    }
  });
});
