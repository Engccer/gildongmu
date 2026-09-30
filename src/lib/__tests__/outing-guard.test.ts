import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 나들이(E51, spec `2026-09-26-outing-mode-design.md` §14) 소스 가드. 판정은 Kit 순수 함수가 테스트로
 * 잠그고, 여기는 컴파일러가 못 잡는 배선만 잠근다.
 */

const ROOT = join(__dirname, "../../..");
const IOS = join(ROOT, "ios");
const MODEL = join(IOS, "Gildongmu/Directions/OutingModel.swift");
const TITLE_MENU = join(IOS, "Gildongmu/TitleMenu.swift");
const SKIP = new Set(["build", ".build", "DerivedData", "node_modules", ".git"]);

function swiftFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...swiftFiles(full));
    else if (name.endsWith(".swift")) out.push(full);
  }
  return out;
}

/** 이름으로 찾은 Swift 함수 본문(여는 중괄호부터 짝이 맞는 닫는 중괄호까지). */
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

describe("나들이 좌우 표현은 OutingSide에서만 나온다(spec §6.1)", () => {
  const SIDE_KEYS = ["ios.outing.passLeft", "ios.outing.passRight", "ios.outing.itemLeft", "ios.outing.itemRight"];

  it("좌우 문구 키는 OutingModel의 두 조립 함수 안에만 있다", () => {
    const users = swiftFiles(IOS).filter((f) => SIDE_KEYS.some((k) => readFileSync(f, "utf8").includes(`"${k}"`)));
    expect(users.map((f) => f.split("/").pop())).toEqual(["OutingModel.swift"]);
    const model = readFileSync(MODEL, "utf8");
    const builders = functionBody(model, "passByLine") + functionBody(model, "overviewItemLine");
    for (const key of SIDE_KEYS) {
      expect(model.split(`"${key}"`).length - 1).toBe(1);
      expect(builders).toContain(`"${key}"`);
    }
  });

  it("두 조립 함수는 OutingSide를 switch한다(문자열·방위에서 좌우를 다시 추론하지 않는다)", () => {
    const model = readFileSync(MODEL, "utf8");
    for (const name of ["passByLine", "overviewItemLine"]) {
      const body = functionBody(model, name);
      expect(body).toMatch(/switch side/);
      expect(body).toMatch(/case \.left:/);
      expect(body).toMatch(/case \.right:/);
      expect(body).toMatch(/case \.unknown:/);
    }
    expect(model).toMatch(/static func passByLine\(name: String, side: OutingSide\)/);
    expect(model).toMatch(/static func overviewItemLine\(name: String, side: OutingSide, meters: Int\)/);
  });

  it("진행 방위는 위치 이력 유도만 쓴다(기기 course 게이트 courseStep 금지)", () => {
    const model = readFileSync(MODEL, "utf8");
    expect(model).toContain("deriveCourse(");
    expect(model).not.toMatch(/courseStep\(/);
  });
});

describe("나들이 진입점", () => {
  it("제목 메뉴 버튼은 나들이 시작(실험판 전용)·새로고침·설정 순서다", () => {
    const menu = readFileSync(TITLE_MENU, "utf8");
    const buttons = menu.match(/Button\(appLocalized\("[^"]+"\)\)/g) ?? [];
    expect(buttons).toEqual([
      'Button(appLocalized("ios.outing.start"))',
      'Button(appLocalized("ios.common.refresh"))',
      'Button(appLocalized("ios.settings.title"))',
    ]);
  });

  it("길찾기 탭 버튼은 도착지 없는 조회의 거절 상태에서만 선다(자동 시작 아님, 위원장 판정 2026-09-26)", () => {
    const tab = readFileSync(join(IOS, "Gildongmu/Directions/DirectionsTabView.swift"), "utf8");
    const at = tab.indexOf("GuideSession.shared.startOuting()");
    const window = tab.slice(Math.max(0, at - 300), at);
    expect(window).toMatch(/model\.phase == \.needEndpoints, model\.from == \.current, model\.to == nil/);
    // 거절 통지는 그대로다(runQuery가 needEndpoints를 알린다).
    expect(tab).toMatch(/phase = \.needEndpoints\s+announce\(appLocalized\("directions\.needEndpoints"\)/);
  });
});

describe("나들이 문장 창구", () => {
  it("게시는 채널 술어 한 번으로 가른다 — 나들이만 전경 VoiceOver 꺼짐에서도 기기 음성(spec §7.3, E53 §2)", () => {
    const post = functionBody(readFileSync(MODEL, "utf8"), "post");
    expect(post).toMatch(/GuideSpeechOutput\.channel\(\s*speechClass, foregroundDeviceSpeech: true,/);
    expect(post).toContain("GuideSpeechOutput.postVoiceOver(");
    expect(post).toContain("deviceSpeech.submit(");
    expect(post).not.toMatch(/isVoiceOverRunning/);
  });

  it("횡단보도 예고는 보호 창을 세우고 주변 문장은 그 창 뒤로 미룬다(한 fix 한 문장, spec 준수 리뷰 M-2)", () => {
    const model = readFileSync(MODEL, "utf8");
    const evaluate = functionBody(model, "evaluate");
    expect(evaluate).toMatch(/sayProtected\(appLocalized\(notice\.hasAudioSignal/);
    expect(evaluate).toMatch(/if crosswalkSpoken \|\| now < protectedUntil \{/);
    expect(evaluate).toMatch(/sayLow\(Self\.passByLine/);
    expect(evaluate).not.toMatch(/[^w]say\(Self\.passByLine/);
  });

  it("stop()은 보류 문장 세대를 올리고 이미 끝난 세션에선 오디오를 다시 원복하지 않는다", () => {
    const stop = functionBody(readFileSync(MODEL, "utf8"), "stop");
    expect(stop.indexOf("announcer.advanceGeneration()")).toBeLessThan(stop.indexOf("guard wasActive else { return }"));
    expect(stop.indexOf("guard wasActive else { return }")).toBeLessThan(stop.indexOf("tones.endSession("));
  });

  it("기기 음성은 세 모델 공유 대기 칸(Kit DeviceSpeechQueue)이고 모델 안에 자체 칸이 없다(E53 §4.2, 복붙 금지)", () => {
    const model = readFileSync(MODEL, "utf8");
    expect(model).toContain("GuideSpeechOutput.makeDeviceQueue(");
    expect(model).not.toMatch(/func speakDevice\(|speechPending|speechDrain/);
    // 선점 금지·한 칸·유효 시간 계약은 Kit 테스트(`DeviceSpeechQueueTests`)가 잠근다.
  });

  it("안전망 종료는 백그라운드에서도 종료음 + 행동 문장이고, 전하지 못하면 복귀 때 한 번 갚는다(E53 위원장 판정, spec §3.4)", () => {
    const model = readFileSync(MODEL, "utf8");
    const idle = functionBody(model, "endIdle");
    expect(idle).toContain("endLeavingScreen(reason: text, playStopTone: true)");
    expect(idle).toContain("sayEnd(text, speechClass: .actionable)");
    expect(model.match(/speechClass: \.deferrable/g)?.length).toBe(1);  // 전경 전용 약신호뿐
    // 종료 문장은 전하지 못하면 장부에 남아 복귀 때 갚는다 — 종료 화면 존재와 무관(설계 리뷰 M6).
    // 장부 시각은 종료 시각이다 — 되돌릴 때의 시각이면 30분 만료가 되돌림마다 미뤄진다(E53 후속 코드 품질 리뷰 n1).
    expect(functionBody(model, "sayEnd")).toMatch(/let endedAt = ContinuousClock\.now[\s\S]*owedEndReason = \(text, endedAt\)/);
    const scene = functionBody(model, "handleScenePhaseChange");
    expect(scene).toContain("if let end = owedEndReason {");
    expect(scene).toContain("isEndScreenStale(secondsSinceEnd: seconds)");
  });
});

describe("나들이 시트 배치(E54)", () => {
  const SHEET = join(IOS, "Gildongmu/Directions/OutingSheet.swift");

  it("\"출발점으로\"는 종료 화면에만 있고 안내 중 최하단엔 \"나들이 종료\"만 남는다", () => {
    const sheet = readFileSync(SHEET, "utf8");
    expect(sheet.split('"ios.outing.returnToOrigin"').length - 1).toBe(1);
    expect(functionBody(sheet, "endSection")).toContain('"ios.outing.returnToOrigin"');
    const inset = sheet.slice(sheet.indexOf(".safeAreaInset(edge: .bottom)"), sheet.indexOf(".task {"));
    expect(inset).toContain('"ios.outing.stop"');
    expect(inset).not.toContain("returnToOrigin");
    // 시트 버튼이 사라지면 미확정 라벨 분기·통지도 함께 없다.
    expect(readFileSync(MODEL, "utf8")).not.toContain("announceOriginPending");
  });

  it("주변 낭독은 펼침 메뉴가 아니라 누를 때마다 다음 단계로 넘어가는 버튼이다", () => {
    const sheet = readFileSync(SHEET, "utf8");
    expect(sheet).not.toMatch(/Menu\(appLocalized\("ios\.outing\.narration"/);
    expect(sheet).toMatch(/Button\(appLocalized\("ios\.outing\.narration"[^\n]*\{\s*narrationRaw = narration\.next\.rawValue\s*\}/);
  });
});

describe("나들이 종료 화면 소거(E31 응답 표식)", () => {
  it("종료 화면 소거는 clearEnd 한 곳이고 거기서 체중 권유 응답 표식을 지운다", () => {
    const model = readFileSync(MODEL, "utf8");
    // 닫기·새 세션·귀환 인계·30분 만료가 전부 clearEnd를 지나야 표식이 다음 화면으로 새지 않는다.
    expect(model.match(/endScreen = nil/g) ?? []).toHaveLength(1);
    for (const name of ["start", "endForReturn", "handleScenePhaseChange"]) {
      expect(functionBody(model, name)).toContain("clearEnd()");
    }
    expect(readFileSync(join(IOS, "Gildongmu/Directions/OutingSheet.swift"), "utf8")).toMatch(
      /appLocalized\("actions\.close"\)[\s\S]*nextWeightPromptDismissals[\s\S]*model\.clearEnd\(\)/,
    );
    // 도보 종료 화면과 같은 키라 나들이 종료 화면이 있을 때만 지운다(도보·대중교통 시작도 clearEnd를 부른다).
    expect(functionBody(model, "clearEnd")).toMatch(
      /if endScreen != nil \{ UserDefaults\.standard\.set\(false, forKey: WalkHealth\.weightPromptEngagedKey\) \}[\s\S]*endScreen = nil/,
    );
  });
});
