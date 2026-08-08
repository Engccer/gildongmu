// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DirEndpoint } from "@/lib/directions-state";
import type { JusoAddress, Place } from "@/lib/types";
import {
  __resetManualLocationForTest,
  setManualLocation,
} from "@/lib/manual-location-store";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));

import { DirectionsView } from "../DirectionsView";

const gangnam: Place = {
  id: "p-gangnam",
  name: "강남역",
  category: "지하철역",
  address: "서울 강남구 역삼동 858",
  roadAddress: "서울 강남구 강남대로 396",
  lat: 37.497,
  lng: 127.027,
};

const juso: JusoAddress = {
  roadAddr: "서울특별시 강동구 성내로 12 (성내동)",
  roadAddrPart1: "서울특별시 강동구 성내로 12",
  jibunAddr: "서울특별시 강동구 성내동 540",
  engAddr: "12 Seongnae-ro, Gangdong-gu, Seoul",
  zipNo: "05397",
  bdNm: "",
};

function stubFetch({
  places = [gangnam],
  addresses = [juso],
  geocode,
}: {
  places?: Place[];
  addresses?: JusoAddress[];
  /** `/api/geocode` 응답(주소 후보 선택 → 좌표 해석 결선 테스트 전용, 미지정 시 기존과 동일하게 미매칭 URL로 throw). */
  geocode?: { status: number; body: unknown };
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/places")) {
        return {
          ok: true,
          json: async () => ({ places, provider: "kakao-local", query: "q" }),
        } as Response;
      }
      if (url.startsWith("/api/address/search")) {
        return { ok: true, json: async () => ({ addresses }) } as Response;
      }
      if (url.startsWith("/api/geocode") && geocode) {
        return {
          ok: geocode.status >= 200 && geocode.status < 300,
          status: geocode.status,
          json: async () => geocode.body,
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function renderView(overrides: { initialTo?: DirEndpoint | null } = {}) {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      onBack={() => {}}
      {...overrides}
    />,
  );
}

function searchField(labelKey: "from" | "to", query: string) {
  fireEvent.change(screen.getByLabelText(labelKey), {
    target: { value: query },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: labelKey === "from" ? "searchFrom" : "searchTo",
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DirectionsView 흐름 전진 포커스", () => {
  it("후보 검색 완료 시 첫 후보(장소 우선)로 포커스가 이동한다", async () => {
    stubFetch();
    renderView();
    searchField("from", "강남");
    // useEffect 포커스는 비동기 반영이라 waitFor 필수(jsdom flake 방지).
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(
        "강남역, 서울 강남구 강남대로 396",
      );
    });
  });

  it("장소 후보가 없으면 첫 주소 후보로 포커스가 이동한다", async () => {
    stubFetch({ places: [] });
    renderView();
    searchField("from", "성내로 12");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(juso.roadAddr);
    });
  });

  it("출발지 확정 → 도착지 입력, 도착지 확정 → 조회 버튼으로 포커스가 전진한다", async () => {
    stubFetch();
    renderView();

    searchField("from", "강남");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("강남역,");
    });
    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(screen.getByLabelText("to"));

    searchField("to", "잠실");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("강남역,");
    });
    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "submit" }),
    );
  });

  it("후보에 포커스가 있는 채로 재검색이 0건이면 입력으로 선점 복귀한다", async () => {
    stubFetch();
    renderView();
    searchField("from", "강남");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("강남역,");
    });
    // 같은 필드 재검색이 0건 — 후보 리스트가 통째로 언마운트되는 상태 전이.
    stubFetch({ places: [], addresses: [] });
    fireEvent.click(screen.getByRole("button", { name: "searchFrom" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("candidateNone");
    });
    // 포커스가 body로 소실되지 않고 입력으로 복귀(제거 전 선점 이동).
    expect(document.activeElement).toBe(screen.getByLabelText("from"));
  });

  it("후보 0건이면 포커스를 옮기지 않고 통지만 한다", async () => {
    stubFetch({ places: [], addresses: [] });
    renderView();
    searchField("from", "ㅁㄴㅇㄹ");
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("candidateNone");
    });
    // 마운트 시 제목 포커스가 그대로 — 결과 없는 검색은 커서를 끌고 가지 않는다.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "title" }),
    );
  });
});

// resolveAddressCoord 공용화(리팩터링) 회귀: 순수함수 단위테스트(resolve-address-coord.test.ts)와
// 별개로, DirectionsView의 selectAddress가 그 반환 kind로 실제로 분기하는지(호출부 결선)를 검증한다.
describe("DirectionsView 주소→좌표 해석 결선(resolveAddressCoord)", () => {
  it("주소 후보 선택 후 좌표 해석 성공 시 출발지가 확정된다", async () => {
    stubFetch({
      places: [],
      geocode: {
        status: 200,
        body: { matches: [{ lat: 37.5, lng: 127.1, addressName: juso.roadAddr }] },
      },
    });
    renderView();
    searchField("from", "성내로 12");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(juso.roadAddr);
    });
    fireEvent.click(document.activeElement as HTMLElement);
    // 성공 경로: onResolve가 돌아 "from" 입력값이 확정 라벨로 바뀐다(endpointToField).
    await waitFor(() => {
      expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe(
        juso.roadAddrPart1,
      );
    });
  });

  it("주소 후보 선택 후 좌표 해석 실패 시 coordError만 통지하고 확정하지 않는다", async () => {
    stubFetch({ places: [], geocode: { status: 502, body: {} } });
    renderView();
    searchField("from", "성내로 12");
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe(juso.roadAddr);
    });
    fireEvent.click(document.activeElement as HTMLElement);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("coordError");
    });
    // 실패 경로: resolveAndClose가 돌지 않아 입력값이 원래 질의 그대로다.
    expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe(
      "성내로 12",
    );
  });
});

// 수동 위치가 켜져 있으면 "현재 위치"라는 표현을 쓰지 않는다(LocationBar와 동형).
// 안내 시작은 항상 실좌표를 다시 조회하므로(useRouteGuide.realfix), 이 브리핑이
// 수동 위치 기준일 때만 그 사실을 안내 시작 진입점 근처에서 미리 말한다.
describe("DirectionsView 수동 위치(manual location)", () => {
  afterEach(() => {
    __resetManualLocationForTest();
  });

  it("origin 있는 수동 위치는 출발지 필드에 manual 라벨로 표시된다", () => {
    setManualLocation({
      label: "길동 카페",
      lat: 37.5384,
      lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    renderView();
    expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe("manual");
  });

  it("origin 없는 수동 위치는 manualUnverifiable 라벨로 표시된다", () => {
    setManualLocation({
      label: "길동 카페",
      lat: 37.5384,
      lng: 127.1432,
      origin: null,
      setAt: 1,
    });
    renderView();
    expect((screen.getByLabelText("from") as HTMLInputElement).value).toBe(
      "manualUnverifiable",
    );
  });

  it("수동 위치 출발지로 조회하면 역지오코딩 없이 그 좌표로 조회하고, 안내 시작 진입점 근처에 실좌표 필요 안내를 낸다", async () => {
    setManualLocation({
      label: "길동 카페",
      lat: 37.5384,
      lng: 127.1432,
      origin: { lat: 37.5384, lng: 127.1432, accuracy: 10, at: Date.now() / 1000 },
      setAt: 1,
    });
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.startsWith("/api/route/car")) {
          return {
            ok: true,
            json: async () => ({ provider: "tmap", durationSeconds: 600 }),
          } as Response;
        }
        if (url.startsWith("/api/route/transit")) {
          return { ok: true, json: async () => ({ result: null }) } as Response;
        }
        if (url.startsWith("/api/route/walk")) {
          return { ok: true, json: async () => ({ result: null }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderView({
      initialTo: { kind: "place", label: "잠실역", coord: { lat: 37.5, lng: 127.1 } },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(screen.getByText("guideNeedsRealLocation")).toBeTruthy();
    });
    // 수동 좌표로 조회했다(GPS 아님) — awaitGeolocation 모크는 항상 error라
    // 실좌표 경로를 탔다면 이 조회 자체가 geoError로 끝나 route fetch가 없다.
    expect(
      calledUrls.some((u) => u.startsWith("/api/route/car?origin=37.5384,127.1432")),
    ).toBe(true);
    // 수동 위치일 때는 역지오코딩(fetchCurrentAddress)을 호출하지 않는다.
    expect(calledUrls.some((u) => u.startsWith("/api/geocode/reverse"))).toBe(false);
  });
});
