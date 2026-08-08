// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGeolocationForTest } from "@/lib/geolocation";
import { __resetManualLocationForTest, setManualLocation } from "@/lib/manual-location-store";
import { useNearbyFetch } from "../useNearbyFetch";

/** 관문이 어느 좌표로 upstream을 부르는지만 본다 — 도메인 파싱은 이 테스트 밖이다. */
const fetchAt = vi.fn(async (_coords: { lat: number; lng: number }) =>
  new Response(JSON.stringify({ ok: true }), { status: 200 }),
);

function Probe({ place }: { place?: { lat: number; lng: number } }) {
  const { status, load } = useNearbyFetch<{ ok: boolean }>({
    source: place ? { kind: "place", ...place } : { kind: "current" },
    fetchAt,
    parse: (body) => ({ kind: "done", data: body as { ok: boolean } }),
  });
  return (
    <>
      <button onClick={() => load(false)}>조회</button>
      <output>{status.kind}</output>
    </>
  );
}

describe("useNearbyFetch — 수동 위치 배선", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGeolocationForTest();
    __resetManualLocationForTest();
    fetchAt.mockClear();
    vi.stubGlobal("navigator", {
      geolocation: {
        // 수동 위치가 이겨야 하므로 GPS는 일부러 먼 좌표를 준다.
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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("수동 위치가 있으면 그 좌표로 조회한다", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "조회" }));
    await waitFor(() =>
      expect(fetchAt).toHaveBeenCalledWith({ lat: 37.5384, lng: 127.1432 }),
    );
  });

  it("장소 앵커는 수동 위치보다 우선한다", async () => {
    setManualLocation({ label: "길동 카페", lat: 37.5384, lng: 127.1432, origin: null, setAt: 1 });
    render(<Probe place={{ lat: 37.9, lng: 127.9 }} />);
    fireEvent.click(screen.getByRole("button", { name: "조회" }));
    await waitFor(() => expect(fetchAt).toHaveBeenCalledWith({ lat: 37.9, lng: 127.9 }));
  });

  it("수동 위치가 없으면 GPS 좌표로 조회한다 (기존 경로 보존)", async () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "조회" }));
    await waitFor(() =>
      expect(fetchAt).toHaveBeenCalledWith({ lat: 35.1796, lng: 129.0756 }),
    );
  });
});
