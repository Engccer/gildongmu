import { describe, expect, it } from "vitest";
import { nearbyLiveMessage, type NearbyLiveStatus } from "@/lib/nearby-live";

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
});
