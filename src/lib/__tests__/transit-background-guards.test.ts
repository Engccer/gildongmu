import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 대중교통 백그라운드 폴(E36, spec `docs/superpowers/specs/2026-09-11-transit-background-poll-design.md`
 * §4.2.2·§4.2.4)의 소스 가드. 앱 타깃엔 테스트 레인이 없어 계약을 정규식으로 잠근다:
 *
 * 1. **백그라운드 발화는 채널 술어만 연다** — `TransitGuideModel.post`가 게시 전에 채널 술어(E53)를 지난다. 정식판은
 *    토글 실효값이 거짓이라 종전 계약(백그라운드는 소리만, 음성은 복귀 시) 그대로다 — 조용한 회귀의 대가가 크다.
 * 2. **백그라운드 톤 허용 집합은 Kit `transitToneAllowedInBackground` 하나가 가른다**(E79, spec
 *    `2026-11-07-e79-transit-background-tones-design.md` §2 — 승차 중 사다리·임박·추세·도착과 첫 관측, 신호 잃음
 *    반복음·경고음 제외). 모델의 `playTone` 호출부는 그 판정 결과 또는 리터럴 `false`만 넘기고 리터럴 `true`는 0곳.
 * 3. **keep-alive 국면 = boarding ∨ riding**(A46) — 앱을 살리는 위치 스트림이 켜지는 조건.
 */

const ROOT = join(__dirname, "../../..");
const MODEL = readFileSync(join(ROOT, "ios/Gildongmu/Directions/TransitGuideModel.swift"), "utf8");

function body(fnSignature: RegExp): string {
  const start = MODEL.search(fnSignature);
  expect(start, `함수 미발견: ${fnSignature}`).toBeGreaterThanOrEqual(0);
  const rest = MODEL.slice(start);
  const end = rest.search(/\n    }\n/);
  return rest.slice(0, end);
}

describe("대중교통 백그라운드 폴 소스 가드 (E36)", () => {
  it("post는 게시 전에 채널 술어를 지나고, 버린 문장은 복귀 표식을 세운다(E53 — 정식판은 종전대로 백그라운드 발화 0)", () => {
    const post = body(/private func post\(\n\s+_ message: String, highPriority: Bool, bypassSuppression: Bool,/);
    const gate = post.indexOf("GuideSpeechOutput.channel(");
    const publish = post.indexOf("GuideSpeechOutput.postVoiceOver(");
    expect(gate, "채널 술어 부재").toBeGreaterThanOrEqual(0);
    expect(publish, "게시 자리 부재").toBeGreaterThanOrEqual(0);
    expect(gate, "술어가 게시보다 뒤에 있다").toBeLessThan(publish);
    // 버림 = 복귀 표식. 백그라운드 판정의 정본은 Kit `guideSpeechChannel`(정식판 등가성은 Kit 테스트가 전수로 잠근다).
    const drop = post.slice(post.indexOf("case .drop:"));
    expect(drop).toContain("missedAnnouncement = true");
    expect(post).not.toContain("AccessibilityNotification.Announcement(");
  });

  it("백그라운드 톤 허용은 Kit 판정 하나를 지난다(E79) — 리터럴 true 0곳, 호출부 전부 인자를 밝힌다", () => {
    // 허용을 참으로 만드는 형태(대입·호출부 리터럴)가 파일에 없다 — Kit 판정을 우회하는 자리(코드 리뷰 C3 변이).
    expect(MODEL.match(/allowedInBackground\s*=\s*true/g) ?? []).toHaveLength(0);
    expect(MODEL.match(/allowedInBackground:\s*true/g) ?? []).toHaveLength(0);
    // 호출부는 전부 인자를 밝힌다(기본값 없음 — 안전 인자). `func playTone(` 선언도 인자 이름을 포함해 통과한다.
    const calls = MODEL.match(/playTone\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.every((call) => call.includes("allowedInBackground:"))).toBe(true);
    // 인자 값은 Kit 판정 결과 셋 중 하나 또는 리터럴 false뿐이다(spec §5) — `!isForeground` 같은 우회 식은 경고음을
    // 잠금 화면에서 울린다(리뷰 MINOR-1). 선언(`allowedInBackground: Bool`)은 제외.
    const ALLOWED_ARGS = new Set([
      "false",
      "allowedInBackground", // handle(event:)의 지역 상수 — 바로 아래에서 Kit 판정 대입을 단언한다
      "transitToneAllowedInBackground(.trend(tone))",
      "transitToneAllowedInBackground(.alightReached)",
    ]);
    const args = [...MODEL.matchAll(/playTone\([^)]*?allowedInBackground:\s*([^\n]*?)\)\s*(?:\}|$|\n)/gm)]
      .map((m) => m[1].trim())
      .filter((arg) => arg !== "Bool");
    expect(args.length).toBe(calls.length - 1);
    for (const arg of args) expect(ALLOWED_ARGS, `허용 밖 인자: ${arg}`).toContain(arg);
    // 재생기 직접 호출은 playTone 안 한 곳뿐이다 — 다른 자리의 `tones.play(`는 백그라운드 게이트를 우회한다(리뷰 MINOR-2).
    expect(MODEL.match(/tones\.play\(/g) ?? []).toHaveLength(1);
    expect(body(/private func playTone\(_ tone: BeaconTone, allowedInBackground: Bool\)/)).toContain("tones.play(tone)");
    // 이벤트 톤은 이벤트 전체를 Kit에 넘긴다 — 톤 종류로 가르면 boarding 사다리(approaching)가 riding 사다리와 섞인다.
    const handle = body(/private func handle\(event: TransitGuideEvent\)/);
    expect(handle).toContain("let allowedInBackground = transitToneAllowedInBackground(.event(event))");
    // 추세 톤 자리: 신호 잃음 반복음(unreliable)을 거르는 판정이 Kit에 있다(판정 ①).
    expect(MODEL).toContain("playTone(tone, allowedInBackground: transitToneAllowedInBackground(.trend(tone)))");
    // 하차 정류장 도착(A69) 톤은 도착 톤이라 허용(판정 ①).
    const alight = body(/private func announceAlightReached\(/);
    expect(alight).toContain("playTone(.nearby, allowedInBackground: transitToneAllowedInBackground(.alightReached))");
    // 세션 시작·종료음은 사용자 조작 응답이라 전경만.
    expect(MODEL.match(/playTone\(\.(start|stop), allowedInBackground: false\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("유휴 정지는 idlePaused 키를 자동 창구 .high로 게시한다", () => {
    const idle = body(/private func enterIdleIfDue\(\) -> Bool/);
    // 정지 사실은 화면 변화가 없어 통지가 유일한 증거다(위원장 판정 2026-09-11, BACKLOG E36).
    // 분류는 미룸(E53 — 안전망이라 백그라운드에서 말하지 않는다. 복귀가 곧 조작이라 재개 문장이 갚는다).
    expect(idle).toContain(
      'announce(appLocalized("transitGuide.idlePaused"), highPriority: true, speechClass: .deferrable)',
    );
    // 타이머 판정이라 즉시 창구가 아니라 자동 창구다 — 톤이 울리는 중이면 그 뒤에 말한다.
    expect(idle).not.toContain("announceNow(");
    // 계측: 전경 여부와 함께 한 줄(백그라운드 정지는 post의 전경 게이트가 버린다).
    expect(idle).toContain('transitGuideLog("idlePaused announced');
  });

  it("keep-alive는 boarding·riding 둘 다에서 켠다(A46) — 유휴·폴 주기 0은 riding과 같이 끈다", () => {
    const keep = body(/private func updateKeepAlive\(\)/);
    const wants = keep.slice(keep.indexOf("let wants"), keep.indexOf("if wants"));
    // 고른 차량을 기다리는 동안 앱이 잠들면 도착 관측(`boarded(observed)`)을 놓친다(위원장 판정 2026-09-23).
    expect(wants).toContain("state.phase == .boarding || state.phase == .riding");
    expect(wants).toContain("!idlePaused");
    expect(wants).toContain("transitPollIntervalMs(state) > 0");
    // waiting은 넣지 않는다 — 고르지도 않은 목록을 배경에서 폴할 이유가 없다.
    expect(wants).not.toContain(".waiting");
  });

  it("백그라운드 진입은 폴 태스크를 취소하지 않는다(폴 지속 계약)", () => {
    const scene = body(/func handleScenePhaseChange\(to phase: ScenePhase\)/);
    const bg = scene.indexOf("case .background:");
    const next = scene.indexOf("case .inactive:");
    expect(bg).toBeGreaterThanOrEqual(0);
    expect(next).toBeGreaterThan(bg);
    expect(scene.slice(bg, next)).not.toContain("pollTask");
  });
});
