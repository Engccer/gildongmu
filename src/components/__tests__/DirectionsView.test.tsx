// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JusoAddress, Place } from "@/lib/types";

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
}: { places?: Place[]; addresses?: JusoAddress[] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith("/api/places")
        ? { places, provider: "kakao-local", query: "q" }
        : url.startsWith("/api/address/search")
          ? { addresses }
          : null;
      if (!body) throw new Error(`unexpected fetch: ${url}`);
      return { ok: true, json: async () => body } as Response;
    }),
  );
}

function renderView() {
  return render(
    <DirectionsView canShowWalk canShowTransit canBriefCarRoute onBack={() => {}} />,
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
