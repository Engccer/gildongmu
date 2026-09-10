import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 대중교통 백그라운드 폴(E36, spec `docs/superpowers/specs/2026-09-11-transit-background-poll-design.md`
 * §4.2.2·§4.2.4)의 소스 가드. 앱 타깃엔 테스트 레인이 없어 두 계약을 정규식으로 잠근다:
 *
 * 1. **백그라운드 발화 0** — `TransitGuideModel.post`가 게시 전에 전경 게이트를 지난다. 접근성 헌장
 *    계약(백그라운드는 소리만, 음성은 복귀 시)이라 조용한 회귀의 대가가 크다.
 * 2. **백그라운드 톤 허용 집합 = 첫 관측(`trackingStarted`) 하나** — `allowedInBackground = true`
 *    대입이 파일에 정확히 한 곳. 사다리·도착·추세 톤을 여기 넣는 것은 별건 판정이다(BACKLOG E36).
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
    // 호출부는 전부 인자를 밝힌다(기본값 없음 — 안전 인자).
    expect(MODEL.match(/playTone\([^)]*\)/g)?.every((call) => call.includes("allowedInBackground:") || call.includes("func playTone")))
      .toBe(true);
  });

  it("백그라운드 폴 정지 표식(pausedInBackground)은 폐지됐다", () => {
    expect(MODEL).not.toContain("pausedInBackground = true");
  });
});
