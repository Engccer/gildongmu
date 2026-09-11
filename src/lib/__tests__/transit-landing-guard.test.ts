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
    for (let i = 0; i < lines.length; i += 1) {
      if (!/\.(task|onAppear)\s*\{/.test(lines[i])) continue;
      // 블록이 길어질 수 있어 8줄 창(설계 리뷰 L7). 시트 열림 착지(title/minimize)는 List 수준 `.task`라 대상 뷰가 아니다 — 그 둘만 허용.
      const window = lines.slice(i, i + 8).join(" ");
      // 래퍼(`boardAlreadyOrAskExpress`가 `.expressPrompt`를 착지시킨다)와 변수 인자 호출도 함께 본다(코드 리뷰 m6).
      if (/landControlFocus\((\.(reboardPrompt|advance|changeBoarding|confirmBoarded|waitingLabel|boardAlready|expressPrompt|expressBlocked|destChangeStatus)|target|inFlight)|boardAlreadyOrAskExpress\(/.test(window)) {
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
