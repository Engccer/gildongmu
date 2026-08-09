// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import {
  __resetManualLocationForTest,
  getManualLocation,
  setManualLocation,
} from "@/lib/manual-location-store";
import { useManualLocationJudgment } from "../useManualLocationJudgment";

function Probe() {
  useManualLocationJudgment();
  return null;
}

/**
 * 트리거 ③(탭 시작) — 마운트 시 판정이 실제로 도는지. 훅을 지웠을 때 이 테스트가
 * red가 나는지가 검출력의 증거다(변이 ⑥).
 */
describe("useManualLocationJudgment", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
  });

  it("마운트 시 판정이 돈다 (트리거 ③ — 탭 시작)", async () => {
    setManualLocation({
      label: "길동 카페", lat: 37.5384, lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: {
              latitude: 35.1796, longitude: 129.0756, accuracy: 10,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    render(<Probe />);
    await vi.waitFor(() => expect(getManualLocation()).toBeNull());
  });
});
