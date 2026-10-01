import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A54: 승차 전 도보를 직접 끝낼 때의 결합 문장과 세션 중 권한 철회 사유.
const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const LOCALES = ["ko", "en", "es", "fr", "it", "ja"] as const;

function beaconKeys(locale: string): Record<string, string> {
  return JSON.parse(read(`ios/i18n/ios-extra/${locale}.json`)).ios.beacon;
}

describe("승차 전 도보 종료 결합 문장(A54)", () => {
  it.each(LOCALES)("%s: 결합용 키는 정지 문장에서 마침표만 뗀 같은 문장이다", (locale) => {
    const keys = beaconKeys(locale);
    expect(keys.stoppedJoin).toBe(keys.stopped.slice(0, -1));
    expect(keys.stoppedJoin).not.toMatch(/[.。]$/);
  });

  it.each(LOCALES)("%s: 꼬리 키는 대중교통 미시작 문장이고 라틴 문자 로케일은 소문자로 시작한다", (locale) => {
    const cancelled: string = JSON.parse(read(`messages/${locale}.json`)).transitGuide.prewalkCancelled;
    const tail = beaconKeys(locale).prewalkCancelledTail;
    expect(tail.toLowerCase()).toBe(cancelled.toLowerCase());
    if (locale !== "ko" && locale !== "ja") expect(tail[0]).toBe(tail[0].toLowerCase());
  });

  it("사용자 정지 결합은 결합용 키와 꼬리 키를 쓴다", () => {
    const source = read("ios/Gildongmu/Directions/GuideSessionCoordinator.swift");
    const stopped = source.slice(source.indexOf("        case .userStopped:"), source.indexOf("        case .ended:"));
    expect(stopped).toContain('appLocalized("ios.beacon.stoppedJoin"), appLocalized("ios.beacon.prewalkCancelledTail")');
    expect(stopped).not.toContain('"ios.beacon.stopped"');
  });

  it("세션 중 CLError.denied는 권한 거부 사유로 끝낸다(신호 약함 아님)", () => {
    const source = read("ios/Gildongmu/Directions/BeaconModel.swift");
    const start = source.indexOf("private func handle(locationError code: CLError.Code)");
    const body = source.slice(start, source.indexOf("\n    }\n", start));
    expect(body).toMatch(/case \.denied:[\s\S]*?stopAndFail\(with: \.denied, key: "beacon\.denied", resolution: \.settings\)/);
    expect(body).not.toContain('"beacon.weak"');
  });
});
