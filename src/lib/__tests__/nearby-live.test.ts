import { describe, expect, it } from "vitest";
import { nearbyLiveMessage, type NearbyLiveStatus } from "@/lib/nearby-live";
import type { UnavailableHereReason } from "@/lib/out-of-coverage";

const t = (key: string, params?: Record<string, string | number | Date>) =>
  params ? `${key}${JSON.stringify(params)}` : key;
const tCommon = t;

describe("nearbyLiveMessage", () => {
  it("idle은 빈 문자열", () => {
    expect(nearbyLiveMessage({ kind: "idle" }, t, tCommon)).toBe("");
  });

  it("locating은 t(locating)", () => {
    expect(nearbyLiveMessage({ kind: "locating" }, t, tCommon)).toBe("locating");
  });

  it("loading은 t(loading)", () => {
    expect(nearbyLiveMessage({ kind: "loading" }, t, tCommon)).toBe("loading");
  });

  it("empty는 t(empty)", () => {
    expect(nearbyLiveMessage({ kind: "empty" }, t, tCommon)).toBe("empty");
  });

  it("error는 t(error)", () => {
    expect(nearbyLiveMessage({ kind: "error" }, t, tCommon)).toBe("error");
  });

  it("geoerror denied는 t(geoDenied)", () => {
    const status: NearbyLiveStatus = { kind: "geoerror", reason: "denied" };
    expect(nearbyLiveMessage(status, t, tCommon)).toBe("geoDenied");
  });

  it("geoerror unsupported는 t(geoUnsupported)", () => {
    const status: NearbyLiveStatus = { kind: "geoerror", reason: "unsupported" };
    expect(nearbyLiveMessage(status, t, tCommon)).toBe("geoUnsupported");
  });

  it("outOfCoverage는 tCommon(outOfCoverage)", () => {
    expect(nearbyLiveMessage({ kind: "outOfCoverage" }, t, tCommon)).toBe("outOfCoverage");
  });

  it("done은 doneMessage 미지정 시 t(ready)", () => {
    expect(nearbyLiveMessage({ kind: "done" }, t, tCommon)).toBe("ready");
  });

  it("done은 doneMessage 지정 시 그 반환값(빈 문자열 포함)", () => {
    expect(nearbyLiveMessage({ kind: "done" }, t, tCommon, () => "결과 3건")).toBe("결과 3건");
    expect(nearbyLiveMessage({ kind: "done" }, t, tCommon, () => "")).toBe("");
  });

  /**
   * ⚠ 사유를 뭉개면 안 된다. "서울에만 있는 서비스"는 다른 지역에서 영원히 결과가
   * 없다는 뜻이고, "이 지역 정류소 데이터 없음"은 그 도메인만 그렇다는 뜻이다.
   * 한 문구로 합치면 사용자가 할 수 있는 일이 달라진다.
   */
  it("unavailableHere는 사유별 문구를 고른다", () => {
    expect(
      nearbyLiveMessage({ kind: "unavailableHere", reason: "seoulOnly" }, t, tCommon),
    ).toBe("unavailableHere.seoulOnly");
    expect(
      nearbyLiveMessage({ kind: "unavailableHere", reason: "noBusData" }, t, tCommon),
    ).toBe("unavailableHere.noBusData");
  });

  it("outOfCoverage(한국 밖)와 unavailableHere(지역 미제공)는 다른 문구다", () => {
    const outOf = nearbyLiveMessage({ kind: "outOfCoverage" }, t, tCommon);
    const here = nearbyLiveMessage(
      { kind: "unavailableHere", reason: "noBusData" }, t, tCommon,
    );
    expect(outOf).not.toBe(here);
  });
});

/**
 * 문구 선택이 동적 키(`unavailableHere.${reason}`)라 오타·누락이 테스트를 통과하고
 * 화면에서 키 문자열로 드러난다. 실제 메시지 파일과 대조해 그 창을 닫는다
 * (iOS는 `check-xcstrings-keys.mjs`가 같은 일을 한다).
 */
describe("unavailableHere 문구 키가 6로케일에 실재한다", () => {
  const reasons: UnavailableHereReason[] = ["seoulOnly", "noBusData"];
  const locales = ["ko", "en", "es", "fr", "it", "ja"] as const;

  it.each(locales)("%s", async (locale) => {
    const messages = (await import(`../../../messages/${locale}.json`)).default;
    for (const reason of reasons) {
      const produced = nearbyLiveMessage(
        { kind: "unavailableHere", reason },
        t,
        (key) => key,
      );
      const path = produced.split(".");
      const value = path.reduce<unknown>(
        (acc, k) => (acc as Record<string, unknown>)?.[k],
        messages.common,
      );
      expect(typeof value, `${locale}: common.${produced} 누락`).toBe("string");
    }
  });
});
