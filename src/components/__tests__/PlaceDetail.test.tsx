// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/station-match", () => ({ isStation: () => false }));
vi.mock("../RouteLinks", () => ({ RouteLinks: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteBriefing: () => null }));
vi.mock("../StationMeta", () => ({ StationMeta: () => null }));
vi.mock("../StationFacilities", () => ({ StationFacilities: () => null }));
vi.mock("../SeoulMetroFacilities", () => ({ SeoulMetroFacilities: () => null }));
vi.mock("../SeoulSubwayArrival", () => ({ SeoulSubwayArrival: () => null }));
vi.mock("../BusArrivals", () => ({ BusArrivals: () => null }));
vi.mock("../BikeStations", () => ({ BikeStations: () => null }));
vi.mock("../LocalConditions", () => ({ LocalConditions: () => null }));
vi.mock("../BarrierFreeInfo", () => ({ BarrierFreeInfo: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteBriefing: () => null }));
vi.mock("../chat/ChatOverlay", () => ({ ChatOverlay: () => null }));

import { PlaceDetail } from "../PlaceDetail";

const place = {
  id: "place-1",
  name: "경복궁 관훈점",
  category: "음식점 > 한식",
  address: "서울 종로구 관훈동 198-42",
  roadAddress: "서울 종로구 인사동5길 38",
  englishAddress: "38 Insadong 5-gil, Jongno-gu, Seoul",
  lat: 37.5725,
  lng: 126.9842,
  phone: "02-722-7713",
};

function renderDetail(overrides: Partial<typeof place> = {}) {
  return render(
    <PlaceDetail
      place={{ ...place, ...overrides }}
      canBriefCarRoute={false}
      canShowBus={false}
      canShowBike={false}
      canShowSubway={false}
      canShowAir={false}
      canShowBarrierFree={false}
      canShowTransit={false}
      onBack={() => {}}
    />,
  );
}

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

afterEach(cleanup);

describe("PlaceDetail 주소 복사", () => {
  it("주소 종류마다 텍스트와 전용 복사 버튼을 같은 반응형 블록에 묶는다", () => {
    renderDetail();
    const road = screen.getByText(`place.roadAddress ${place.roadAddress}`);
    const copyRoad = screen.getByRole("button", { name: "place.copyRoadAddress" });
    const addressRow = road.parentElement;

    expect(addressRow?.contains(copyRoad)).toBe(true);
    expect(addressRow?.classList.contains("flex")).toBe(true);
    expect(addressRow?.classList.contains("items-start")).toBe(true);
    expect(addressRow?.classList.contains("gap-2")).toBe(true);
    expect(addressRow?.classList.contains("w-fit")).toBe(true);
    expect(addressRow?.classList.contains("max-w-full")).toBe(true);
    expect(copyRoad.classList.contains("min-h-11")).toBe(true);
    expect(copyRoad.classList.contains("min-w-11")).toBe(true);
    expect(copyRoad.classList.contains("shrink-0")).toBe(true);
  });

  it("도로명·지번 주소를 각각 줄과 버튼으로 낸다", () => {
    renderDetail();
    expect(screen.getByText(`place.roadAddress ${place.roadAddress}`)).toBeTruthy();
    expect(screen.getByText(`place.jibunAddress ${place.address}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "place.copyRoadAddress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "place.copyJibunAddress" })).toBeTruthy();
  });

  it("빈 주소는 줄도 복사 버튼도 만들지 않는다", () => {
    renderDetail({ englishAddress: undefined, roadAddress: "" });
    expect(screen.queryByRole("button", { name: "place.copyEnglishAddress" })).toBeNull();
    expect(screen.queryByRole("button", { name: "place.copyRoadAddress" })).toBeNull();
    expect(screen.getByRole("button", { name: "place.copyJibunAddress" })).toBeTruthy();
  });

  it("주소 다음에 복사 버튼, 전화번호 순으로 읽히고 통지 영역은 하나뿐이다", () => {
    const { container } = renderDetail();
    const road = screen.getByText(`place.roadAddress ${place.roadAddress}`);
    const copyRoad = screen.getByRole("button", { name: "place.copyRoadAddress" });
    const phone = screen.getByText("02-722-7713").closest("p");
    expect(phone).toBeTruthy();

    expect(
      road.compareDocumentPosition(copyRoad) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      copyRoad.compareDocumentPosition(phone!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const liveRegions = container.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions.length).toBe(1);
    // 통지 전용 영역 — 주소 줄을 감싸면 장소 전환 시 주소가 통째로 재낭독된다.
    expect(liveRegions[0].contains(road)).toBe(false);
    expect(liveRegions[0].textContent).toBe("");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByText("place.addressCopied")).toBeNull();
  });

  it("도로명 버튼은 도로명을, 지번 버튼은 지번을 복사하고 각각 통지한다", async () => {
    const writeText = mockClipboard();
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "place.copyRoadAddress" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(place.roadAddress);
      expect(screen.getByText("place.addressCopied").classList.contains("sr-only")).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "place.copyJibunAddress" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(place.address);
      expect(screen.getByText("place.addressCopied").classList.contains("sr-only")).toBe(true);
    });
  });

  it("영문 주소가 있으면 영문 복사 버튼이 영문 주소를 복사한다", async () => {
    const writeText = mockClipboard();
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "place.copyEnglishAddress" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(place.englishAddress);
    });
  });
});
