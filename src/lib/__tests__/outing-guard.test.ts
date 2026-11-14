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
  // E82: 가게 묶음 문장은 쪽을 앞에 두는 틀(`bundleLeft`·`bundleRight`)을 따로 쓴다 — 한 곳 문장의 틀에 이름 여럿을
  // 넣으면 쪽이 뒤에 오는 언어에서 어느 이름까지가 그 쪽인지 들리지 않는다. 틀 함수가 셋이 됐을 뿐 규칙은 같다:
  // 좌우 키는 `OutingSide`를 switch하는 함수 안에만 있다.
  const SIDE_KEYS = [
    "ios.outing.passLeft",
    "ios.outing.passRight",
    "ios.outing.bundleLeft",
    "ios.outing.bundleRight",
    "ios.outing.itemLeft",
    "ios.outing.itemRight",
  ];
  const SIDE_BUILDERS = ["passByLine", "bundleSideLine", "overviewItemLine"];

  it("좌우 문구 키는 OutingModel의 세 조립 함수 안에만 있다", () => {
    const users = swiftFiles(IOS).filter((f) => SIDE_KEYS.some((k) => readFileSync(f, "utf8").includes(`"${k}"`)));
    expect(users.map((f) => f.split("/").pop())).toEqual(["OutingModel.swift"]);
    const model = readFileSync(MODEL, "utf8");
    const builders = SIDE_BUILDERS.map((name) => functionBody(model, name)).join("");
    for (const key of SIDE_KEYS) {
      expect(model.split(`"${key}"`).length - 1).toBe(1);
      expect(builders).toContain(`"${key}"`);
    }
  });

  it("세 조립 함수는 OutingSide를 switch한다(문자열·방위에서 좌우를 다시 추론하지 않는다)", () => {
    const model = readFileSync(MODEL, "utf8");
    for (const name of SIDE_BUILDERS) {
      const body = functionBody(model, name);
      expect(body).toMatch(/switch side/);
      expect(body).toMatch(/case \.left:/);
      expect(body).toMatch(/case \.right:/);
      expect(body).toMatch(/case \.unknown:/);
    }
    expect(model).toMatch(/static func passByLine\(name: String, side: OutingSide\)/);
    expect(model).toMatch(/static func overviewItemLine\(name: String, side: OutingSide, meters: Int\)/);
  });

  it("교차로 좌우 문구 키(E58 ①)는 junctionLine 안에만 있고 그 함수는 OutingSide를 switch한다", () => {
    const JUNCTION_SIDE_KEYS = [
      "ios.outing.junctionLeftAlley",
      "ios.outing.junctionRightAlley",
      "ios.outing.junctionLeftPath",
      "ios.outing.junctionRightPath",
    ];
    const users = swiftFiles(IOS).filter((f) =>
      JUNCTION_SIDE_KEYS.some((k) => readFileSync(f, "utf8").includes(`"${k}"`)),
    );
    expect(users.map((f) => f.split("/").pop())).toEqual(["OutingModel.swift"]);
    const model = readFileSync(MODEL, "utf8");
    const body = functionBody(model, "junctionLine");
    for (const key of JUNCTION_SIDE_KEYS) {
      expect(model.split(`"${key}"`).length - 1).toBe(1);
      expect(body).toContain(`"${key}"`);
    }
    expect(body).toMatch(/switch side/);
    expect(body).toMatch(/case \.unknown:/);
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
    expect(evaluate).toContain("speakCrosswalk(notice, queued: false)");
    expect(functionBody(model, "speakCrosswalk")).toMatch(
      /appLocalized\(notice\.hasAudioSignal[\s\S]*protectedUntil = uptimeNow \+ protectSeconds\s*protectedText = text/,
    );
    expect(evaluate).toMatch(/if crosswalkSpoken \|\| now < protectedUntil \{/);
    // E82 V4: 가게는 문장이 아니라 id로 묶음에 쥐고, 문장은 채널이 빌 때 `flushAmbient`가 만든다 — 판정 자리(`evaluate`)는
    // 어떤 가게 문장도 직접 내지 않는다(최신이 이기는 칸에 문장을 넣으면 앞 문장이 사라진다).
    expect(evaluate).toMatch(/bundle\.observe\(candidates: candidates, stopped: stopped\)/);
    expect(evaluate).not.toMatch(/passByLine|bundleLine|say(Low)?\(/);
    expect(evaluate.trimEnd().endsWith("flushAmbient()\n    }") || /flushAmbient\(\)\s*\}\s*$/.test(evaluate)).toBe(true);
    const flush = functionBody(model, "flushAmbient");
    // 채널이 비었을 때만: 끝 신호 대기 없음, 보호 창 밖, 지연 슬롯·톤·VoiceOver 통지·기기 음성 칸이 모두 빔.
    for (const cond of [
      "now >= protectedUntil",
      "now >= ambientHoldUntil",
      "!announcer.hasPending",
      "speechDeferStep(now: now, toneEndsAt: tones.toneEndsAt) == 0",
      "GuideSpeechOutput.announcementsFinished",
      "deviceSpeech.isIdle",
      "ambientChannelOpen",
    ]) {
      expect(flush, cond).toContain(cond);
    }
    expect(flush).toContain("bundle.compose(relations: relations)");
    // 「말했다」 표시는 끝 신호에서만(V5): 문장을 낸 자리가 아니라 `finishAmbient`가 닫는다.
    expect(flush).not.toMatch(/finishSpoken/);
    const finish = functionBody(model, "finishAmbient");
    expect(finish).toMatch(/if spoken \{\s*noteSpoken\(bundle\.finishSpoken\(\), line: flight\.line\)\s*\} else \{[\s\S]{0,200}let drop = bundle\.finishDropped\(counted: !flight\.cutByGuide\)/);
    // 안내가 스스로 낸 문장이 끊은 것은 끊김 횟수에 세지 않는다 — 표시는 모든 문장이 지나는 `say` 한 곳에서 선다.
    expect(functionBody(model, "say")).toContain("if speechClass != .ambient { ambientInFlight?.cutByGuide = true }");
    expect(functionBody(model, "emitAmbient")).toContain("ambientInFlight = (uptimeNow, isBundle, text, retried, false, record, line)");
    // 끊김 상한(리뷰 MUST): 쉬는 시간과 포기는 Kit 묶음이 정하고 모델은 그 값을 그대로 쓴다 — 고정 3초로 되돌리지 않는다.
    expect(finish).toContain("hold = drop.holdSeconds");
    expect(finish).toContain("if !drop.givenUp.isEmpty { notePassedBy(drop.givenUp) }");
    expect(finish).toContain("ambientHoldUntil = uptimeNow + hold");
    // 세션 경계는 전달 장부도 비운다(끝난 세션 문장의 늦은 끝 신호).
    expect(functionBody(model, "resetAmbient")).toContain("GuideSpeechOutput.resetDeliveries()");
    // 묶음 문장: 한 곳뿐이면 종전 한 곳 문장, 구분은 문자열 자원에서.
    const line = functionBody(model, "bundleLine");
    expect(line).toContain("return passByLine(name: groups[0].1[0], side: groups[0].0)");
    expect(line).toContain('appLocalized("ios.outing.bundleNameSeparator")');
    expect(line).toContain('appLocalized("ios.outing.bundleSideSeparator")');
    const emit = functionBody(model, "emitAmbient");
    expect(emit).toMatch(/onDropped: \{ \[weak self\] in self\?\.finishAmbient\(epoch: epoch, spoken: false\) \}/);
    expect(emit).toMatch(/onSpoken: \{ \[weak self\] in self\?\.finishAmbient\(epoch: epoch, spoken: true\) \}/);
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

  it("「방금 말한 것」의 지난 시간은 시트 등장·기록 변경 때 잡은 기준 시각으로 센다(E82 V11)", () => {
    // 그리는 순간의 시각으로 세면 위치 갱신마다 줄 글이 바뀌어 커서가 머문 줄을 VoiceOver가 다시 읽는다.
    const sheet = readFileSync(SHEET, "utf8");
    const history = sheet.slice(sheet.indexOf("private var historySection"), sheet.indexOf("private func historyRow"));
    expect(history).not.toContain("Date()");
    expect(history).toContain("historyRow(entry, now: historyNow)");
    expect(sheet).toMatch(/\.onChange\(of: model\.history\.entries\.map\(\\\.id\)\) \{\s*historyNow = Date\(\)\.timeIntervalSince1970\s*\}/);
  });
});

describe("받아쓰기 중 횡단보도 경고(E82 V25~V27)", () => {
  const model = readFileSync(MODEL, "utf8");
  const speech = readFileSync(join(IOS, "Gildongmu/SpeechService.swift"), "utf8");
  const session = readFileSync(join(IOS, "Gildongmu/Directions/GuideSessionCoordinator.swift"), "utf8");

  it("판정은 장부 한 곳이고, 막힘 여부는 그 자리에서 읽어 넘긴다", () => {
    const evaluate = functionBody(model, "evaluate");
    // 예고 판정은 끝까지 말한 것만 건너뛰고, 끝나지 않은 경고(쥔 것·낸 채 끝 신호를 기다리는 것)가 있는 동안 새 횡단보도를
    // 받지 않는 「한 번에 하나」는 장부(`OutingCrosswalkLedger.notice`의 `busy`)가 지킨다 — 시나리오는 Kit 테스트.
    expect(evaluate).toContain("spoken: crosswalkLedger.spoken)");
    expect(evaluate).toContain("crosswalkLedger.notice(notice, silencing: silencing, suppressed: outputSuppressed)");
    // 표시를 장부 밖에서 따로 넣지 않는다(쥘 때 표시가 서면 문장 없이 「말한 횡단보도」가 된다).
    expect(model).not.toMatch(/spokenCrosswalks/);
    // 진동은 쥔 때 한 번이다 — 말하는 갈래에는 없다.
    expect(evaluate).toMatch(/case \.vibrate:\s*guideDiagLog\([^\n]*\)\s*ResultHaptic\.fire\(\.attention\)\s*case \.hold:\s*break/);
  });

  it("막힘이 풀리는 모든 길은 outputSuppressed의 한 자리를 지나고 거기서 쥔 경고를 낸다", () => {
    expect(model).toMatch(
      /var outputSuppressed = false \{\s*didSet \{\s*tones\.isSuppressed = outputSuppressed\s*if oldValue, !outputSuppressed \{ releaseHeldCrosswalk\(\) \}/,
    );
    // 풀림은 잠시 미뤄(받아쓴 원문 통지가 먼저 게시되게) VoiceOver 대기열 뒤로 낸다(M2 순서).
    expect(functionBody(model, "releaseHeldCrosswalk")).toContain(
      "scheduleHeldCrosswalk(after: outingCrosswalkReleaseDelaySeconds, queued: true, mayDefer: false)",
    );
    const speakHeld = functionBody(model, "speakHeldCrosswalk");
    // 내려던 순간 다시 막혔으면 쥔 채 진동만 한다(재시도 지연 사이에 받아쓰기가 시작된 경우).
    expect(speakHeld).toMatch(/if outputSuppressed \{\s*let vibrate = crosswalkLedger\.stillSuppressed\(\)[\s\S]*?return\s*\}/);
    // 후보에서 사라졌거나 예고 범위 밖이거나 뒤쪽이 확실하면 말하지 않는다(판정은 Kit 한 함수).
    expect(speakHeld).toContain("outingHeldCrosswalkVerdict(fix: lastFix, heading: heading, crosswalk: crosswalks[held.id])");
    expect(speakHeld).toMatch(/crosswalkLedger\.release\(verdict: verdict, silencing: silencing\)[\s\S]*speakCrosswalk\(notice, queued: queued\)/);
    // 버림 뒤 재시도는 다른 안내 문장이 끝나지 않았으면(지연 슬롯·VoiceOver 통지·기기 음성) 한 번 더 미룬다 — 기본 우선순위라
    // 갈림길 예고를 끊거나 지연 슬롯의 문장을 버린다. 미룬 예약은 다시 미루지 않는다(무한 연기 없음).
    expect(speakHeld).toMatch(
      /if mayDefer, announcer\.hasPending \|\| !GuideSpeechOutput\.announcementsFinished\s*\|\| GuideSpeechOutput\.speechBusy\(deviceSpeech\) \{[\s\S]*?scheduleHeldCrosswalk\(after: outingCrosswalkRetryDelaySeconds, queued: queued, mayDefer: false\)\s*return\s*\}/,
    );
    expect(speakHeld.indexOf("if mayDefer")).toBeGreaterThan(speakHeld.indexOf("if outputSuppressed"));
    expect(speakHeld.indexOf("if mayDefer")).toBeLessThan(speakHeld.indexOf("crosswalkLedger.release("));
    // 받아쓰기의 억제 해제는 나들이 모델의 그 값에 대입으로 닿는다(다른 화면의 받아쓰기도 같은 창구다).
    expect(functionBody(session, "setDictationActive")).toContain("outing.outputSuppressed = prior.outing && outing.outputSuppressed");
    // 받아쓰기가 끝나는 길(권한 거부·시작 실패·정지·취소·인식 실패)은 전부 억제를 푼다. 세대가 어긋난 시작은 풀지 않는다 —
    // 그 세대를 올린 취소가 이미 풀었다.
    expect(speech.match(/setGuideSuppressed\(false\)/g)).toHaveLength(5);
    expect(functionBody(speech, "cancel")).toMatch(/generation \+= 1[\s\S]*setGuideSuppressed\(false\)/);
    expect(functionBody(speech, "stop")).toContain("setGuideSuppressed(false)");
  });

  it("「말했다」는 끝 신호에서만 서고, 버림은 막힘과 무관하게 다시 쥔다(M1·M2)", () => {
    const speak = functionBody(model, "speakCrosswalk");
    expect(speak).toContain("onDropped: { [weak self] in self?.crosswalkDropped(notice) }");
    expect(speak).toContain("onSpoken: { [weak self] in self?.crosswalkSpokenToEnd(notice) }");
    // 표시를 세우는 자리는 끝 신호 하나다(낸 때 세우면 받아쓰기 시작·완료가 끊은 경고가 「말한 것」으로 남는다).
    expect(model.match(/crosswalkLedger\.spoke\(/g) ?? []).toHaveLength(1);
    expect(functionBody(model, "crosswalkSpokenToEnd")).toContain("crosswalkLedger.spoke(notice.id)");
    // 받아쓰기 시작은 기기 음성을 억제보다 먼저 멈춘다 — 막힌 때만 쥐면 그 끊김이 빠져나간다.
    const dropped = functionBody(model, "crosswalkDropped");
    expect(dropped).not.toMatch(/outputSuppressed else \{ return \}/);
    expect(dropped).toContain("crosswalkLedger.dropped(notice, suppressed: outputSuppressed)");
    expect(dropped).toMatch(/case \.retry:[^\n]*\n[^\n]*\n\s*scheduleHeldCrosswalk\(after: outingCrosswalkRetryDelaySeconds, queued: false, mayDefer: true\)/);
    // 대기열 뒤로 내는 표식은 `post`가 한 번 소비하고 VoiceOver 게시에 실린다.
    const post = functionBody(model, "post");
    expect(post).toMatch(/let queued = message == queuedText\s*if queued \{ queuedText = nil \}/);
    expect(post).toContain("highPriority: highPriority, queued: queued,");
    // 표식은 관찰 대상이 아니다(뷰가 그리지 않는다).
    expect(model).toContain("@ObservationIgnored private var queuedText: String?");
    const output = readFileSync(join(IOS, "Gildongmu/Directions/GuideSpeechOutput.swift"), "utf8");
    expect(output).toMatch(/\} else if queued \{\s*attributed\.accessibilitySpeechAnnouncementPriority = \.low\s*\}/);
    // 대기열 뒤로 낸 통지의 끝 신호 만료는 상한을 쓴다(앞선 낭독을 기다리는 동안 버림으로 닫혀 두 번 나가지 않게, 재리뷰 S-1).
    expect(output).toContain("if let outcome { trackDelivery(text, queued: queued, outcome: outcome) }");
    expect(output).toContain("deliveries.posted(text, at: ProcessInfo.processInfo.systemUptime, queued: queued)");
    expect(output).toContain("VoiceOverDeliveryLedger.expirySeconds(for: text, queued: queued) + 0.1");
  });

  it("진단 로그는 말한 글을 쓰지 않는다(종류와 글자 수만)", () => {
    const post = functionBody(model, "post");
    expect(post).toContain("chars=\\(message.count)");
    expect(post).not.toMatch(/text=\\\(message\)/);
    // 끝 신호 로그도 글자 수만 남긴다(가게 이름이 문장 앞부분에 있다).
    const output = readFileSync(join(IOS, "Gildongmu/Directions/GuideSpeechOutput.swift"), "utf8");
    const finish = output.slice(output.indexOf("announceFinish type="), output.indexOf("announceFinish type=") + 400);
    expect(finish).toContain('chars=\\((text ?? "").count)');
    expect(output).not.toMatch(/\.prefix\(\d+\)/);
  });

  it("세션이 끝나면 쥔 것을 버린 뒤에 억제를 푼다 — 끝난 세션의 경고가 나오지 않는다", () => {
    const stop = functionBody(model, "stop");
    expect(stop.indexOf("crosswalkLedger = OutingCrosswalkLedger()")).toBeGreaterThan(-1);
    expect(stop.indexOf("crosswalkLedger = OutingCrosswalkLedger()")).toBeLessThan(stop.indexOf("outputSuppressed = false"));
    expect(stop.indexOf("status = .idle")).toBeLessThan(stop.indexOf("outputSuppressed = false"));
    // 다시 낼 예약도 함께 거둔다 — 세션 시작의 초기화도 같다(전 세션의 재시도가 새 세션에서 돌지 않게).
    expect(stop).toMatch(/crosswalkLedger = OutingCrosswalkLedger\(\)\s*heldCrosswalkTask\?\.cancel\(\)/);
    expect(functionBody(model, "resetSessionState")).toMatch(
      /crosswalkLedger = OutingCrosswalkLedger\(\)\s*heldCrosswalkTask\?\.cancel\(\)\s*heldCrosswalkTask = nil/,
    );
  });

  it("녹음 세션은 나들이 세션이 살아 있을 때만 녹음 중 진동을 허용한다(V27)", () => {
    // 공유 오디오 세션에 남는 속성이라 매번 값을 명시한다(리터럴 true면 정식판 받아쓰기의 시작음·진동도 녹음 중에 난다).
    expect(functionBody(speech, "beginListening")).toMatch(
      /session\.setCategory\(\.playAndRecord[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*try\? session\.setAllowHapticsAndSystemSoundsDuringRecording\(GuideSession\.shared\.outing\.isTracking\)\s*try session\.setActive\(true/,
    );
    expect(speech.match(/setAllowHapticsAndSystemSoundsDuringRecording\(/g) ?? []).toHaveLength(1);
  });
});

describe("나들이 종료 화면 소거(E31 응답 표식)", () => {
  it("종료 화면 소거는 clearEnd 한 곳이고 거기서 체중 권유 응답 표식을 지운다", () => {
    const model = readFileSync(MODEL, "utf8");
    // 닫기·새 세션·귀환 인계·30분 만료가 전부 clearEnd를 지나야 표식이 다음 화면으로 새지 않는다.
    expect(model.match(/endScreen = nil/g) ?? []).toHaveLength(1);
    for (const name of ["start", "endForHandover", "handleScenePhaseChange"]) {
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

describe("나들이 장소 목록은 종료 즉시 비운다(E58 후속 ④, 카카오 저장 금지 축)", () => {
  it("stop()이 wasActive 가드 앞에서 장소와 그 유도물을 비운다", () => {
    const model = readFileSync(MODEL, "utf8");
    const body = functionBody(model, "stop");
    const guardAt = body.indexOf("guard wasActive else { return }");
    expect(guardAt).toBeGreaterThan(0);
    // 가드 뒤에 두면 이미 끝난 세션(종료 화면 → 귀환)의 재호출에서 건너뛴다 — 가드 앞이어야 모든 종료 경로가 지난다.
    for (const line of ["places = [:]", "relations = [:]", "bundle = OutingBundle()", "overviewRelations = [:]", "aheadText = nil"]) {
      const at = body.indexOf(line);
      expect(at, line).toBeGreaterThan(0);
      expect(at, line).toBeLessThan(guardAt);
    }
  });

  it("종료 화면은 장소를 들고 있지 않고, 조망은 종료 전이에서 닫힌다(비움의 전제)", () => {
    const model = readFileSync(MODEL, "utf8");
    const endScreen = model.slice(model.indexOf("struct EndScreen"), model.indexOf("struct ReturnTarget"));
    expect(endScreen).not.toMatch(/SurroundingPlace|places/);
    expect(readFileSync(join(IOS, "Gildongmu/Directions/OutingSheet.swift"), "utf8")).toMatch(
      /onChange\(of: model\.endScreen\)[\s\S]{0,200}overviewAdapter = nil/,
    );
  });
  it("조망은 세션이 끝나면 마지막 행을 그대로 낸다(닫히기 전 한 프레임에 \"없음\"으로 다시 그려지지 않게)", () => {
    const adapter = readFileSync(join(IOS, "Gildongmu/Directions/OutingOverviewAdapter.swift"), "utf8");
    expect(adapter).toMatch(/var overviewRows: \[GuideOverviewRow\] \{\s*guard model\.isTracking else \{ return lastRows \}/);
  });
});
