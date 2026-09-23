import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 대중교통 백그라운드 폴(E36, spec `docs/superpowers/specs/2026-09-11-transit-background-poll-design.md`
 * §4.2.2·§4.2.4)의 소스 가드. 앱 타깃엔 테스트 레인이 없어 계약을 정규식으로 잠근다:
 *
 * 1. **백그라운드 발화 0** — `TransitGuideModel.post`가 게시 전에 전경 게이트를 지난다. 접근성 헌장
 *    계약(백그라운드는 소리만, 음성은 복귀 시)이라 조용한 회귀의 대가가 크다.
 * 2. **백그라운드 톤 허용 집합 = 첫 관측(`trackingStarted`) 하나** — `allowedInBackground = true`
 *    대입이 파일에 정확히 한 곳. 사다리·도착·추세 톤을 여기 넣는 것은 별건 판정이다(BACKLOG E36).
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
  it("post는 게시 전에 전경 게이트를 지난다(백그라운드 발화 0)", () => {
    const post = body(/private func post\(_ message: String, highPriority: Bool, bypassSuppression: Bool\)/);
    const gate = post.indexOf("guard isForeground else {");
    const publish = post.indexOf("AccessibilityNotification.Announcement(");
    expect(gate, "전경 게이트 부재").toBeGreaterThanOrEqual(0);
    expect(publish, "게시 자리 부재").toBeGreaterThanOrEqual(0);
    expect(gate, "게이트가 게시보다 뒤에 있다").toBeLessThan(publish);
    expect(post).toContain("missedAnnouncement = true");
  });

  it("백그라운드 톤 허용은 정확히 한 자리(trackingStarted)", () => {
    const allowed = MODEL.match(/allowedInBackground = true/g) ?? [];
    expect(allowed).toHaveLength(1);
    const at = MODEL.indexOf("allowedInBackground = true");
    // 그 대입은 `.trackingStarted` 판별 안에서만 참이다.
    const line = MODEL.slice(MODEL.lastIndexOf("\n", at) + 1, MODEL.indexOf("\n", at));
    expect(line).toContain("case .trackingStarted = event");
    // 호출부 리터럴 `allowedInBackground: true`는 0곳 — 대입 1곳을 우회하는 형태(코드 리뷰 C3 변이).
    expect(MODEL.match(/allowedInBackground:\s*true/g) ?? []).toHaveLength(0);
    // 호출부는 전부 인자를 밝힌다(기본값 없음 — 안전 인자). `func playTone(` 선언은 정규식이 `playTone(`부터
    // 잡으므로 인자 이름을 포함해 같은 조건을 통과한다.
    const calls = MODEL.match(/playTone\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.every((call) => call.includes("allowedInBackground:"))).toBe(true);
  });

  it("유휴 정지는 idlePaused 키를 자동 창구 .high로 게시한다", () => {
    const idle = body(/private func enterIdleIfDue\(\) -> Bool/);
    // 정지 사실은 화면 변화가 없어 통지가 유일한 증거다(위원장 판정 2026-09-11, BACKLOG E36).
    expect(idle).toContain('announce(appLocalized("transitGuide.idlePaused"), highPriority: true)');
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
