import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 대중교통 안내 시트 착지 계약의 소스 가드(A35, spec 2026-09-11-transit-station-to-place-and-landing §4.1·§6).
 *
 * 뷰 계층엔 테스트 레인이 없고 착지는 시뮬레이터로 검출되지 않는다(실기기 로그 `landed=`만이 판정). 그래서
 * "구조가 지켜지는가"만 소스에서 잠근다 — 세 기제(컬링·VO 재배치·트리거 결손)에 대응하는 자리가 되돌아가면
 * 실기기 두 세션이 지나야 알게 되기 때문이다. Swift 소스를 웹 테스트가 읽는 선례: `transit-display-guard.test.ts`.
 */
const ROOT = join(__dirname, "../../..");
const SHEET = readFileSync(join(ROOT, "ios/Gildongmu/Directions/TransitTrackingSheet.swift"), "utf8");
const PANEL = readFileSync(join(ROOT, "src/components/TransitGuidePanel.tsx"), "utf8");

describe("TransitTrackingSheet 착지 계약 (A35)", () => {
  it("focusedControl 바인딩은 landingTarget 헬퍼 안 한 자리에만 붙는다 — 가시화 키·실현 관측이 함께 달리는 유일한 경로", () => {
    const raw = SHEET.match(/\.accessibilityFocused\(\$focusedControl/g) ?? [];
    expect(raw).toHaveLength(1);
    // 그 한 자리가 헬퍼 본문이다(다른 곳에서 우회 부착하면 위 개수는 같아도 헬퍼가 비어 있을 수 있다).
    const helperStart = SHEET.indexOf("private func landingTarget");
    const helper = SHEET.slice(helperStart, SHEET.indexOf("\n    }\n", helperStart));
    expect(helper).toContain(".accessibilityFocused($focusedControl, equals: control)");
    expect(helper).toContain(".id(Self.controlId(control))");
    expect(helper).toContain(".onAppear { rendered.appear(control) }");
    expect(helper).toContain(".onDisappear { rendered.disappear(control) }");
  });

  it("가시화는 전 대상이다 — scrollTo에 대상별 분기·default 없음(종전 '상단 버튼은 첫 화면 안' 전제가 거짓이었다)", () => {
    const start = SHEET.indexOf("private func scrollTo(");
    const body = SHEET.slice(start, SHEET.indexOf("\n    }", start));
    expect(body).not.toContain("default");
    expect(body).not.toContain("case .");
    expect(body).toContain("proxy.scrollTo(Self.controlId(target))");
  });

  it("착지 트리거는 상태 변화다 — 대상 뷰의 .task/.onAppear가 landControlFocus를 부르지 않는다(트리거 결손 차단)", () => {
    const lines = SHEET.split("\n");
    // 면제는 시트 열림 착지 하나뿐이다 — List 수준 `.task`라 **대상 뷰가 아니다**(대상이 실현되지 않아도 돈다).
    // 종전엔 그 대상 이름(`title`/`minimize`)을 정규식에서 빼는 것으로 면제했는데, E38로 열림 착지가 `.status`가
    // 되면서 그 방식은 대상 뷰 착지까지 함께 눈감는다 — 자리를 표지(`returnedFromBand`)로 가른다.
    const exemptAt = lines.findIndex((l, i) =>
      /\.task\s*\{/.test(l) && lines.slice(i, i + 8).join(" ").includes("returnedFromBand"),
    );
    expect(exemptAt, "시트 열림 착지(List 수준 .task)가 사라졌다").toBeGreaterThan(-1);
    for (let i = 0; i < lines.length; i += 1) {
      if (i === exemptAt) continue;
      if (!/\.(task|onAppear)\s*\{/.test(lines[i])) continue;
      // 블록이 길어질 수 있어 8줄 창(설계 리뷰 L7).
      const window = lines.slice(i, i + 8).join(" ");
      // 래퍼(`boardAlreadyOrAskExpress`가 `.expressPrompt`를 착지시킨다)와 변수 인자 호출도 함께 본다(코드 리뷰 m6).
      if (/landControlFocus\((\.(reboardPrompt|status|waitingLabel|expressPrompt|expressBlocked|destChangeStatus|minimize)|target|inFlight)|boardAlreadyOrAskExpress\(/.test(window)) {
        throw new Error(`${i + 1}: 대상 뷰 .task/.onAppear가 착지를 부른다 — ${lines[i].trim()}`);
      }
    }
    // 역 선택 화면 착지는 픽커가 열리는 두 상태 변화가 부른다.
    expect(SHEET).toContain(".onChange(of: model.reboardPickerActive)");
    expect(SHEET).toContain(".onChange(of: model.aboardStep)");
  });

  it("실패 폴백은 전 대상 공용이다 — 호출부 onMiss 클로저 없음, 폴백 문장 switch가 exhaustive(default 없음)", () => {
    expect(SHEET).not.toContain("onMiss");
    const start = SHEET.indexOf("private func landingFallbackText(");
    const body = SHEET.slice(start, SHEET.indexOf("\n    }\n", start));
    expect(body).not.toMatch(/\bdefault:/);
    expect(SHEET).toContain("model.announceLandingFallback(text)");
  });

  it("계측 한 줄에 판정 축이 전부 있다 — attempts·elapsedMs·rendered·reason·vo, 배경 시도는 deferred로 기록", () => {
    for (const key of ["attempts=", "elapsedMs=", "rendered=", "reason=", "vo=", "deferred=true", "note=deferred", "reason=\\(LandingOutcome.cancelled.rawValue)"]) {
      expect(SHEET, key).toContain(key);
    }
    // 진행 중 표식의 소유권은 **세대**다(E38 코드 리뷰 MEDIUM-1) — 대상 동일성으로 판별하면 대상이 하나로
    // 통일된 뒤 취소된 옛 Task가 새 Task의 표식을 지우고, 배경 전환이 착지를 끊지 못해 판정 축이 오염된다.
    expect(SHEET).toContain("defer { if landingGen == gen { landingInFlight = nil } }");
    expect(SHEET).not.toContain("defer { if landingInFlight == target");
    // 배경·모달에선 시도하지 않는다(L4·A1) — 진입 게이트 + 배경 전환의 진행 중 착지 이월(M1) + 최소화 취소(M2).
    expect(SHEET).toContain("!model.isForeground ? .background");
    expect(SHEET).toContain("(detailPlace != nil || changeDestPresented) ? .modal");
    expect(SHEET).toContain(".onChange(of: scenePhase)");
    expect(SHEET).toContain("case .background:");
    expect(SHEET).toContain(".onDisappear { controlFocusTask?.cancel() }");
  });

  it("실현 관측은 관찰 대상이 아닌 참조 카운트다(L2·L3) — @State Set 금지", () => {
    expect(SHEET).not.toMatch(/@State private var rendered: Set</);
    expect(SHEET).toContain("@State private var rendered = RenderedControls()");
    expect(SHEET).toContain("final class RenderedControls");
  });
});

describe("TransitTrackingSheet 착지 대상 (E38) · boarding 수동 진행 (N3 ①)", () => {
  it("[탑승했습니다]는 없다 — boarding 버튼은 래치를 지나고 착지 대상에서도 사라졌다", () => {
    // 문자열 키와 착지 case가 함께 사라져야 한다(둘 중 하나만 지우면 폴백 문장이나 버튼이 되살아난다).
    expect(SHEET).not.toContain("transitGuide.confirmBoarded");
    expect(SHEET).not.toMatch(/case \.confirmBoarded/);
    expect(SHEET).toContain("if model.boardingManualAvailable {");
    expect(SHEET).toContain('? appLocalized("transitGuide.boardSelected")');
    expect(SHEET).toContain(': appLocalized("transitGuide.boardSelectedBus")) { model.confirmBoarded() }');
  });

  it("국면 전이 착지는 상태 문장이 기본이고 예외는 차량 선택 목록 하나다(E38)", () => {
    const start = SHEET.indexOf("private func phaseTransitionLanding(");
    expect(start, "전이 착지 판정 함수가 없다").toBeGreaterThan(-1);
    const body = SHEET.slice(start, SHEET.indexOf("\n    }", start));
    // 본문에 나오는 착지 대상은 둘뿐이다 — 종전처럼 전이마다 다음 행동 버튼을 고르는 자리로 돌아가면
    // 여기서 걸린다(반환형만으로는 잠기지 않아 가드가 그 자리를 대신한다).
    const targets = [...body.matchAll(/return (?:controlExists\(\.\w+\) \? )?\.(\w+)(?: : \.(\w+))?/g)]
      .flatMap((m) => [m[1], m[2]])
      .filter((t): t is string => Boolean(t));
    expect([...new Set(targets)].sort()).toEqual(["status", "waitingLabel"]);
    for (const t of [
      "if phase == .arrived { return .status }",
      "if phase == .boarding, previous == .waiting { return .status }",
      "if phase == .riding, previous == .waiting { return .status }",
      // →waiting만 예외: 도착하는 화면이 차량 선택 목록이라 그 질문 라벨에 앉는다(위원장 판정 2026-09-12).
      // 목록이 서지 않는 갈래엔 라벨이 없으므로 기본값으로 떨어진다(안 그러면 착지도 폴백도 없다).
      "return controlExists(.waitingLabel) ? .waitingLabel : .status",
    ]) {
      expect(body, t).toContain(t);
    }
    // ⚠ boarding → riding은 여전히 착지가 아니다(N3 ① 구현 리뷰 M1): 그 승격은 폴이 일으키고
    // 커서는 이미 상태 문장에 앉아 있어 착지시키면 듣던 문장을 끊는 포커스 강탈이 된다.
    expect(body).not.toContain("previous == .waiting || previous == .boarding");
    // `.status`는 상태 문장 줄에 달린다(폴백 문장도 같은 조립기를 읽는다 — 드리프트 차단).
    expect(SHEET).toContain("landingTarget(distanceText(text), .status)");
    // 폴백은 화면과 같은 낭독 라벨을 지난다(a11y 감사 L1).
    expect(SHEET).toContain("return spokenUnits(model.statusLineText(state: state, leg: leg, now: model.positionClock))");
  });

  it("목록 안 포커스 소실 복귀는 질문 라벨 착지와 다른 축이다 — 대상은 `waitingLabel` 고정(a11y 감사 M3)", () => {
    // ⓐ pickVehicle 질문 라벨과 ⓑ 폴링으로 후보 행이 사라졌을 때의 **목록 안 제자리 복구**가 같은 대상을
    // 공유한다. ⓐ를 옮기는 사람이 ⓑ까지 옮기면 폴 한 번에 커서가 목록 밖으로 튕긴다(헌장 §5 강탈 금지).
    const at = SHEET.indexOf(".onChange(of: rows.map(\\.id))");
    expect(at, "목록 소실 복귀 onChange가 없다").toBeGreaterThan(-1);
    const body = SHEET.slice(at, at + 400);
    expect(body).toContain("landControlFocus(.waitingLabel, proxy: proxy, note: \"lost=\\(focused)\")");
  });

  it("착지 대상 집합은 상태 문장 + 자기 질문 화면뿐이다 — 죽은 대상도 새 대상도 없다(E38)", () => {
    // 위원장 판정: 시트에서 무엇을 누르든 커서는 상태 문장 행. 남은 대상은 **그 화면 자체가 질문인 자리**
    // (역 선택·급행 확인·차량 선택 라벨)와 띠바 복귀·목적지 전환 상태 행뿐이다. 종전 대상
    // `advance`·`changeBoarding`·`boardAlready`·`title`을 되살리려면 그 판정부터 뒤집어야 한다.
    const allowed = [
      "status",
      "waitingLabel",
      "reboardPrompt",
      "expressPrompt",
      "expressBlocked",
      "minimize",
      "destChangeStatus",
    ].sort();
    // ① enum에 죽은 case가 남지 않는다(소스 가드가 죽은 대상을 잠그면 다음 사람이 대상으로 읽는다).
    const enumStart = SHEET.indexOf("enum SheetControl: Hashable {");
    const enumBody = SHEET.slice(enumStart, SHEET.indexOf("\n    }", enumStart));
    const cases = [...enumBody.matchAll(/^\s*case (\w+)$/gm)].map((m) => m[1]).sort();
    expect(cases).toEqual(allowed);
    // ② 착지 호출의 리터럴 대상도 그 집합 안이다(변수 인자는 이월 두 자리 — 위 목록이 이미 잠근다).
    const called = [...SHEET.matchAll(/landControlFocus\(\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(called)].sort()).toEqual(allowed);
    // ③ 사용자가 누르는 다음 행동 버튼들은 착지 대상이 아니다 — `landingTarget` 부착이 없어야 한다.
    for (const label of [
      'Button(advanceLabel) { advanceOrHandoff() }',
      'Button(appLocalized("transitGuide.changeBoarding")) { model.beginReboard() }',
    ]) {
      expect(SHEET, label).toContain(label);
      expect(SHEET, label).not.toContain(`landingTarget(${label}`);
    }
  });
});

describe("TransitGuidePanel 착지 대상 (E38 웹 미러)", () => {
  it("전이 착지는 상태 문장이 기본이고 →waiting만 목록 라벨이다 — 컴포넌트 테스트로는 잠기지 않는 축", () => {
    // ⚠ **이 가드가 필요한 이유**(변이 주입 실측): →waiting 전이 착지를 통째로 지워도 컴포넌트 테스트가
    // 초록이다. 목록 포커스 소실 복귀(`optionKeys` effect)가 같은 자리로 되돌리기 때문이다 — 후보 행에
    // 커서를 얹고 열차를 고르면 제거된 행의 blur가 오지 않아 `listHadFocusRef`가 참으로 남고, 나중에
    // 목록이 갱신될 때 그 안전망이 `waitingLabel`에 착지시킨다. 두 경로가 같은 결과를 내므로 결과 단언은
    // 어느 쪽이 만든 것인지 구별하지 못한다. 구조를 여기서 잠근다.
    const at = PANEL.indexOf("const landsOnLabel =");
    expect(at, "→waiting 전이의 목록 라벨 착지 판정이 없다").toBeGreaterThan(-1);
    expect(PANEL.slice(at, at + 200)).toContain(
      'const landsOnLabel = phase === "waiting" && previous !== null && previous !== "waiting";',
    );
    // 라벨이 없는 갈래(지방버스)에선 기본값인 상태 문장으로 떨어진다 — iOS `controlExists` 분기의 미러.
    expect(PANEL).toContain("(waitingLabelRef.current ?? statusRef.current)?.focus();");
    // 나머지 전이는 상태 문장 하나다. `lands` 술어에 대상 선택이 되살아나면 여기서 걸린다.
    const landsAt = PANEL.indexOf("const lands =");
    const lands = PANEL.slice(landsAt, PANEL.indexOf("if (landsOnLabel)", landsAt));
    expect(lands).not.toContain("Ref.current");
    for (const t of [
      '(phase !== null && previous === null) ||',
      '(phase === "arrived" && previous !== "arrived") ||',
      '(phase === "boarding" && previous === "waiting") ||',
      '(phase === "riding" && previous === "waiting");',
    ]) {
      expect(lands, t).toContain(t);
    }
    // 종전 대상 ref는 사라졌다 — 되살리면 전이마다 대상이 다시 갈린다.
    for (const dead of ["advanceRef", "changeBoardingRef", "boardAlreadyRef"]) {
      expect(PANEL, dead).not.toContain(dead);
    }
  });
});

describe("TransitGuideModel boarding 래치·폴 주기 (N3 ①)", () => {
  const MODEL = readFileSync(join(ROOT, "ios/Gildongmu/Directions/TransitGuideModel.swift"), "utf8");

  it("래치는 국면에 들어올 때 지우고 관측이 끝나면 세운다 — 소거 두 줄이 함께 있어야 한다", () => {
    expect(MODEL).toContain(
      "if result.state.phase != .boarding || state.phase != .boarding {",
    );
    expect(MODEL).toContain(
      "if result.state.phase == .boarding, transitBoardingObservationLost(result.state.signal) {",
    );
    // 세션 종료·경로 교체도 지운다(웹 `stopSession` 미러). 넷 = 선언 기본값 + stop + changeRoute + dispatch.
    expect(MODEL.match(/boardingManualAvailable = false/g) ?? []).toHaveLength(4);
  });

  it("관측 승격 직후 즉폴을 넣지 않는다 — 그 창이 `boarded` 통지의 지연 슬롯과 겹친다(구현 리뷰 H1)", () => {
    // 되살리면 웜 응답에서 "탑승" 문장이 latest-wins로 버려진다(그 비대칭을 주석이 설명한다).
    expect(MODEL).not.toMatch(/phaseBefore == \.boarding/);
    expect(MODEL).toContain("승격 직후 즉폴을 넣으면");
  });
});

describe("TransitTrackingSheet 지하철역 → 장소 상세 (E33)", () => {
  it("상태 문장은 언제나 같은 Text이고 역 언급은 로터 액션으로만 — 뷰 종류가 폴마다 갈리지 않는다(설계 리뷰 E2)", () => {
    const start = SHEET.indexOf("private var statusRows");
    const body = SHEET.slice(start, SHEET.indexOf("\n    }\n", start));
    // 뷰 종류를 가르는 분기·`.accessibilityActions` 밖의 Button이 없어야 한다(spec 리뷰 m3 — `Button(라벨)` 꼴 회귀도 잡는다).
    expect(body).not.toMatch(/if mentions|switch mentions/);
    const actionsAt = body.indexOf(".accessibilityActions {");
    expect(actionsAt).toBeGreaterThan(-1);
    expect(body.slice(0, actionsAt)).not.toMatch(/\bButton\s*[({]/);  // 주석의 "Button↔Text"는 코드가 아니다
    // 액션 라벨은 descriptor를 지난다(E1 — 렌더러가 다른 descriptor와 같은 언어 규칙을 적용한다).
    expect(body).toContain("transitOpenStationLine(");
  });

  it("장소 상세는 중첩 시트 하나(`.sheet(item: $detailPlace)`)를 지난다 — 목적지·경유역 공용", () => {
    expect(SHEET.match(/\.sheet\(item: \$detailPlace, onDismiss: \{/g) ?? []).toHaveLength(1);
    expect(SHEET).not.toContain("showPlaceDetail");
    // 역 상세 열기는 사용자 조작이다(E36 유휴 시계).
    const open = SHEET.slice(SHEET.indexOf("private func openStationDetail("), SHEET.indexOf("\n    }\n", SHEET.indexOf("private func openStationDetail(")));
    expect(open).toContain("model.touchUserAction()");
    expect(open).toContain("transitStopPlace(stop)");
  });
});
