// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.phone ? `${key}:${values.phone}` : key,
  useLocale: () => "ko",
}));

// 자식 섹션은 표식으로만 그린다 — 이 파일은 배치(순서·구성)만 본다.
const { marker, metaState } = vi.hoisted(() => ({
  metaState: { shown: true },
  marker:
    (name: string) =>
    ({ embedded }: { embedded?: boolean }): ReactNode => (
      <div data-section={embedded ? `${name}:embedded` : name} />
    ),
}));
vi.mock("../RouteLinks", () => ({ RouteLinks: marker("RouteLinks") }));
vi.mock("../PlaceHoursLine", () => ({ PlaceHoursLine: marker("PlaceHoursLine") }));
// 메타가 조회된 상태를 흉내 낸다 — 역 레이아웃은 출처 줄을 역 정보 섹션 끝에 붙인다.
vi.mock("../StationMeta", async () => {
  const { useEffect } = await import("react");
  const Marker = marker("StationMeta");
  return {
    StationMeta: (props: { embedded?: boolean; onShownChange?: (shown: boolean) => void }) => {
      const { onShownChange } = props;
      useEffect(() => onShownChange?.(metaState.shown), [onShownChange]);
      return Marker(props);
    },
  };
});
vi.mock("../StationTimetable", () => ({ StationTimetable: marker("StationTimetable") }));
vi.mock("../StationFacilities", () => ({ StationFacilities: marker("StationFacilities") }));
vi.mock("../SeoulMetroFacilities", () => ({ SeoulMetroFacilities: marker("SeoulMetroFacilities") }));
vi.mock("../SeoulSubwayArrival", () => ({ SeoulSubwayArrival: marker("SeoulSubwayArrival") }));
vi.mock("../BusArrivals", () => ({ BusArrivals: marker("BusArrivals") }));
vi.mock("../BikeStations", () => ({ BikeStations: marker("BikeStations") }));
vi.mock("../LocalConditions", () => ({ LocalConditions: marker("LocalConditions") }));
vi.mock("../BarrierFreeInfo", () => ({ BarrierFreeInfo: marker("BarrierFreeInfo") }));
vi.mock("../chat/ChatOverlay", () => ({ ChatOverlay: () => null }));

import { PlaceDetail } from "../PlaceDetail";
import type { Place } from "@/lib/types";

afterEach(() => {
  cleanup();
  metaState.shown = true;
});

const base: Place = {
  id: "kakao-21160622",
  name: "천호역 5호선",
  category: "교통,수송 > 지하철,전철 > 수도권5호선",
  address: "서울 강동구 천호동 425-5",
  roadAddress: "서울 강동구 천호대로 997",
  lat: 37.5387,
  lng: 127.1234,
  phone: "02-6311-5471",
};

function renderDetail(place: Partial<Place> = {}) {
  return render(
    <PlaceDetail
      place={{ ...base, ...place }}
      canShowBus
      canShowBike
      canShowSubway
      canShowAir
      canShowBarrierFree
      canShowChat
      onOpenDirections={() => {}}
      onOpenDirectionsFrom={() => {}}
      onBack={() => {}}
    />,
  );
}

/** 읽기 순서대로 표식·제목·전화 링크·버튼·분류 줄을 늘어놓는다. */
function readingOrder(container: HTMLElement): string[] {
  // 선택자 목록 조회는 jsdom에서 문서 순서를 보장하지 않는다 — 전 요소를 순서대로 돌며 거른다.
  const wanted = "[data-section], h2, h3, a[href^='tel:'], button, p";
  const nodes = Array.from(container.querySelectorAll("*")).filter((n) => n.matches(wanted));
  return nodes.flatMap((n) => {
    if (n instanceof HTMLElement && n.dataset.section) return [n.dataset.section];
    if (n.tagName === "H2" || n.tagName === "H3") return [`${n.tagName.toLowerCase()}:${n.textContent}`];
    if (n.tagName === "A") return ["tel"];
    if (n.tagName === "BUTTON") return [`button:${n.textContent}`];
    if (n.textContent === "stationMeta.source") return ["source"];
    return n.textContent?.startsWith("place.category") ? ["category"] : [];
  });
}

describe("역 상세 레이아웃 (E44 spec §3.2)", () => {
  it("지하철역: 역 정보(전화 맨 위) → 도착·시간표·시설 → 무장애 → 길찾기 → 이 장소 주변(최하단)", () => {
    const { container } = renderDetail();
    expect(readingOrder(container)).toEqual([
      "button:detail.back",
      `h2:${base.name}`,
      "h3:stationMeta.heading",
      "tel",
      "StationMeta:embedded",
      "button:place.copyRoadAddress",
      "button:place.copyJibunAddress",
      "PlaceHoursLine",
      "source",
      "button:placeChat.launch",
      "SeoulSubwayArrival",
      "StationTimetable",
      "StationFacilities",
      "SeoulMetroFacilities",
      "BarrierFreeInfo",
      "h3:directions.title",
      "button:directions.toHere",
      "button:directions.fromHere",
      "RouteLinks",
      "h3:place.nearbyHeading",
      "BusArrivals",
      "BikeStations",
      "LocalConditions",
    ]);
  });

  it("이 장소 주변 섹션이 전부 게이트로 빠지면 그 제목도 없다", () => {
    render(
      <PlaceDetail
        place={base}
        canShowBus={false}
        canShowBike={false}
        canShowSubway
        canShowAir={false}
        canShowBarrierFree
        onBack={() => {}}
      />,
    );
    expect(screen.queryByRole("heading", { name: "place.nearbyHeading" })).toBeNull();
  });

  it("역 정보 제목은 전화·메타가 없어도 서고, 메타가 없으면 출처 줄도 없다", () => {
    metaState.shown = false;
    const { container } = renderDetail({ phone: undefined });
    expect(readingOrder(container)).not.toContain("source");
    expect(screen.getByRole("heading", { level: 3, name: "stationMeta.heading" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("분류 줄은 기차역만 — 역 정보 안, 메타 줄 다음", () => {
    const { container } = renderDetail({
      name: "서울역",
      category: "교통,수송 > 기차,철도 > 기차역 > KTX정차역",
      phone: "1544-7788",
    });
    const order = readingOrder(container);
    expect(order.slice(2, 6)).toEqual(["h3:stationMeta.heading", "tel", "StationMeta:embedded", "category"]);
    expect(readingOrder(renderDetail().container)).not.toContain("category");
  });

  it("운영사 대표번호는 대표번호라고 밝히고(판정 ⑥), 역 직통은 번호만", () => {
    renderDetail({ phone: "1544-7788" });
    expect(screen.getByRole("link").textContent).toBe("place.representativePhone:1544-7788");
    expect(screen.getByRole("link").getAttribute("href")).toBe("tel:1544-7788");
    cleanup();
    renderDetail();
    expect(screen.getByRole("link").textContent).toBe("02-6311-5471");
  });
});

describe("역 레이아웃 밖은 개편 전 그대로 (spec §3.1 nil)", () => {
  it("출구 POI(넓은 isStation만 참): 기본 정보 → 길찾기 → 역 섹션(region) → 주변 → 무장애", () => {
    const { container } = renderDetail({
      name: "천호역 5호선 5번출구",
      category: "교통,수송 > 지하철,전철 > 지하철출구",
    });
    expect(readingOrder(container)).toEqual([
      "button:detail.back",
      "h2:천호역 5호선 5번출구",
      "category",
      "button:place.copyRoadAddress",
      "button:place.copyJibunAddress",
      "PlaceHoursLine",
      "tel",
      "RouteLinks",
      "button:directions.toHere",
      "button:directions.fromHere",
      "button:placeChat.launch",
      "StationMeta",
      "SeoulSubwayArrival",
      "StationTimetable",
      "StationFacilities",
      "SeoulMetroFacilities",
      "BusArrivals",
      "BikeStations",
      "LocalConditions",
      "BarrierFreeInfo",
    ]);
  });

  it("출구 POI는 역 레이아웃이 아니라 대표번호를 밝히지 않는다(spec §5.5 nil 경계)", () => {
    renderDetail({
      name: "수원역 1번출구",
      category: "교통,수송 > 지하철,전철 > 지하철출구",
      phone: "1544-7788",
    });
    expect(screen.getByRole("link").textContent).toBe("1544-7788");
  });

  it("비역 장소는 역 섹션이 없고 대표번호도 밝히지 않는다", () => {
    const { container } = renderDetail({
      id: "kakao-1",
      name: "길동 치과",
      category: "의료,건강 > 치과",
      phone: "1588-1234",
    });
    const order = readingOrder(container);
    expect(order).not.toContain("StationMeta");
    expect(order).not.toContain("h3:stationMeta.heading");
    expect(screen.getByRole("link").textContent).toBe("1588-1234");
  });
});
