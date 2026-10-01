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

  it.each(LOCALES)("%s: 문장 틀 키는 사유 뒤에 마침표를 찍고 대중교통 미시작 문장을 잇는 두 문장이다(위원장 판정)", (locale) => {
    const cancelled: string = JSON.parse(read(`messages/${locale}.json`)).transitGuide.prewalkCancelled;
    const frame = beaconKeys(locale).prewalkCancelledWith;
    expect(frame).toBe(locale === "ja" ? `{reason}。${cancelled}` : `{reason}. ${cancelled}`);
  });

  it("사용자 정지는 마침표 없는 정지 키를 문장 틀에 넣어 두 문장으로 낸다", () => {
    const source = read("ios/Gildongmu/Directions/GuideSessionCoordinator.swift");
    const stopped = source.slice(source.indexOf("        case .userStopped:"), source.indexOf("        case .ended:"));
    expect(stopped).toContain('appLocalized("ios.beacon.prewalkCancelledWith", appLocalized("ios.beacon.stoppedJoin"))');
    expect(stopped).not.toContain('"ios.beacon.stopped"');
    expect(stopped).not.toContain("joinText(");
  });

  it("렌더: 사용자 정지(ko·en)와 권한 상실(ko) 최종 문장", () => {
    const render = (locale: string, reason: string) =>
      beaconKeys(locale).prewalkCancelledWith.replace("{reason}", reason);
    expect(render("ko", beaconKeys("ko").stoppedJoin)).toBe("거리 추적을 종료했습니다. 대중교통 안내는 시작하지 않았습니다.");
    expect(render("en", beaconKeys("en").stoppedJoin)).toBe("Distance tracking stopped. Transit guidance was not started.");
    const denied: string = JSON.parse(read("messages/ko.json")).beacon.denied;
    expect(render("ko", denied)).toBe("위치 권한이 필요합니다. 대중교통 안내는 시작하지 않았습니다.");
  });

  it("세션 중 CLError.denied는 권한 거부 사유로 끝낸다(신호 약함 아님)", () => {
    const source = read("ios/Gildongmu/Directions/BeaconModel.swift");
    const start = source.indexOf("private func handle(locationError code: CLError.Code)");
    const body = source.slice(start, source.indexOf("\n    }\n", start));
    expect(body).toMatch(/case \.denied:[\s\S]*?stopAndFail\(with: \.denied, key: "beacon\.denied", resolution: \.settings\)/);
    expect(body).not.toContain('"beacon.weak"');
  });
});
