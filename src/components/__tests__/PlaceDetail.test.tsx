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

function renderDetail() {
  return render(
    <PlaceDetail
      place={place}
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

afterEach(cleanup);

describe("PlaceDetail 주소 복사", () => {
  it("주소 텍스트와 복사 버튼을 같은 반응형 블록에 묶는다", () => {
    renderDetail();
    const copyButton = screen.getByRole("button", { name: "place.copyAddress" });
    const address = screen.getByText(`place.address ${place.englishAddress}`);
    const addressBlock = address.parentElement?.parentElement;

    expect(addressBlock).toBeTruthy();
    expect(addressBlock?.contains(copyButton)).toBe(true);
    expect(addressBlock?.classList.contains("flex")).toBe(true);
    expect(addressBlock?.classList.contains("items-start")).toBe(true);
    expect(addressBlock?.classList.contains("gap-2")).toBe(true);
    expect(addressBlock?.classList.contains("w-fit")).toBe(true);
    expect(addressBlock?.classList.contains("max-w-full")).toBe(true);
    expect(address.parentElement?.classList.contains("flex-1")).toBe(false);
    expect(copyButton.classList.contains("min-h-11")).toBe(true);
    expect(copyButton.classList.contains("min-w-11")).toBe(true);
    expect(copyButton.classList.contains("shrink-0")).toBe(true);
  });

  it("주소 다음에 복사 버튼, 전화번호 순으로 읽힌다", () => {
    const { container } = renderDetail();
    const address = screen.getByText(`place.address ${place.englishAddress}`);
    const copyButton = screen.getByRole("button", { name: "place.copyAddress" });
    const phone = screen.getByText("02-722-7713").closest("p");
    expect(phone).toBeTruthy();

    expect(
      address.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      copyButton.compareDocumentPosition(phone!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();
  });

  it("주 주소를 클립보드에 쓰고 성공 상태를 통지한다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "place.copyAddress" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(place.englishAddress);
      expect(screen.getByRole("status").textContent).toBe("place.addressCopied");
    });
  });
});
