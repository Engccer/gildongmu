import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 결과 진동(E30 확장, `docs/BACKLOG.md` §5 E30 확장 판정 2026-09-13)의 소스 가드. 앱 타깃엔 테스트 레인이
 * 없어 세 계약을 정규식으로 잠근다:
 *
 * 1. **어휘는 iOS 표준 3종, 창구는 `ResultHaptic.fire` 하나** — `UINotificationFeedbackGenerator`·
 *    `UIImpactFeedbackGenerator`를 직접 만드는 파일은 스위치 밖의 기존 발원지 4곳 + 창구뿐이다. 새 자리가
 *    직접 생성하면 "진동 알림 확장" 스위치를 우회한다.
 * 2. **창구가 스위치를 읽는다** — `TrendHaptics.storageKey` 게이트가 `fire` 첫 줄.
 * 3. **길찾기 조회 통지는 결과 종류를 반드시 밝힌다** — `DirectionsTabView.announce(_:haptic:)`의 `haptic`은
 *    기본값이 없고 모든 호출부가 인자를 적는다(nil은 결과가 아닌 문장이라는 명시).
 * 4. **대중교통 유휴 정지는 정지 톤을 낸다**(소리 결함 정정) — 전경에서만.
 */

const ROOT = join(__dirname, "../../..");
const APP = join(ROOT, "ios/Gildongmu");

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return swiftFiles(full);
    return name.endsWith(".swift") ? [full] : [];
  });
}

const read = (rel: string) => readFileSync(join(APP, rel), "utf8");

describe("결과 진동 소스 가드 (E30 확장)", () => {
  it("UIKit 제너레이터 직접 생성은 기존 발원지 4곳 + 창구뿐", () => {
    // 스위치 밖 발원지(위원장 판정 "기존은 그대로"): 안내 톤 재생기(CoreHaptics 폴백)·받아쓰기 시작/정지·
    // 홀드 제스처 잠금/취소·채팅 답변 도착. 여기 더하려면 그 판정을 먼저 바꾼다.
    const allowed = new Set([
      "ResultHaptic.swift",
      "Directions/BeaconTonePlayer.swift",
      "SpeechService.swift",
      "HoldDictationButton.swift",
      "Chat/ChatModel.swift",
    ]);
    const offenders = swiftFiles(APP)
      .filter((f) => /UI(Notification|Impact|Selection)FeedbackGenerator\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(APP.length + 1))
      .filter((rel) => !allowed.has(rel));
    expect(offenders).toEqual([]);
  });

  it("ResultHaptic.fire는 스위치를 첫 줄에서 읽고 표준 3종만 낸다", () => {
    const src = read("ResultHaptic.swift");
    const fire = src.slice(src.indexOf("static func fire("));
    const gate = fire.indexOf("UserDefaults.standard.bool(forKey: TrendHaptics.storageKey)");
    const generator = fire.indexOf("UINotificationFeedbackGenerator()");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(generator);
    expect(fire).toContain("notificationOccurred(.success)");
    expect(fire).toContain("notificationOccurred(.warning)");
    expect(fire).toContain("notificationOccurred(.error)");
    // 맞춤 패턴(CoreHaptics)은 여기 없다 — 어휘를 늘리는 것은 판정 사안.
    expect(src).not.toContain("CHHapticEngine");
  });

  it("DirectionsTabView.announce는 haptic 인자에 기본값이 없고 호출부가 전부 밝힌다", () => {
    const src = read("Directions/DirectionsTabView.swift");
    expect(src).toContain("private func announce(_ message: String, haptic: ResultHaptic.Kind?)");
    expect(src).not.toMatch(/haptic: ResultHaptic\.Kind\? = /);
    const calls = src.match(/(?<![\w.])announce\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((call) => call.includes("haptic:"))).toBe(true);
  });

  it("대중교통 유휴 정지는 전경 한정 정지 톤을 낸다", () => {
    const src = read("Directions/TransitGuideModel.swift");
    const start = src.indexOf("private func enterIdleIfDue() -> Bool");
    const body = src.slice(start, src.indexOf("\n    }\n", start));
    expect(body).toContain("playTone(.stop, allowedInBackground: false)");
  });
});
