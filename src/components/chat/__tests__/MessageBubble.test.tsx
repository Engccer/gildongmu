// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "ko",
}));

// self-fetch 컴포넌트 mock — 실제 렌더 시 fetch/geolocation 필요하므로 최소 stub
vi.mock("@/components/SubwayArrivalsNearby", () => ({
  SubwayArrivalsNearby: () => <div data-testid="subway-nearby" />,
}));
vi.mock("@/components/NightClinicsNearby", () => ({
  NightClinicsNearby: () => <div data-testid="clinics-nearby" />,
}));
vi.mock("@/components/KidsPlacesNearby", () => ({
  KidsPlacesNearby: () => <div data-testid="kids-nearby" />,
}));
vi.mock("@/components/SurroundingsNearby", () => ({
  SurroundingsNearby: () => <div data-testid="surroundings-nearby" />,
}));
// 좌표 도구 컴포넌트 mock
vi.mock("@/components/BusArrivals", () => ({
  BusArrivals: (props: { mode: string; lat?: number; lng?: number }) => (
    <div data-testid="bus-arrivals" data-mode={props.mode} />
  ),
}));
vi.mock("@/components/BikeStations", () => ({
  BikeStations: (props: { mode: string; lat?: number; lng?: number }) => (
    <div data-testid="bike-stations" data-mode={props.mode} />
  ),
}));
vi.mock("@/components/AirQuality", () => ({
  AirQuality: (props: { lat: number; lng: number }) => (
    <div data-testid="air-quality" data-lat={props.lat} data-lng={props.lng} />
  ),
}));
// dest 도구 컴포넌트 mock
vi.mock("@/components/CarRouteBriefing", () => ({
  CarRouteBriefing: (props: { dest: { lat: number; lng: number; name: string } }) => (
    <div
      data-testid="car-route-briefing"
      data-dest-name={props.dest.name}
      data-dest-lat={props.dest.lat}
      data-dest-lng={props.dest.lng}
    />
  ),
}));
vi.mock("@/components/TransitRouteBriefing", () => ({
  TransitRouteBriefing: (props: { dest: { lat: number; lng: number; name: string } }) => (
    <div
      data-testid="transit-route-briefing"
      data-dest-name={props.dest.name}
      data-dest-lat={props.dest.lat}
      data-dest-lng={props.dest.lng}
    />
  ),
}));
// 역명 도구 컴포넌트 mock
vi.mock("@/components/StationMeta", () => ({
  StationMeta: (props: { stationName: string }) => (
    <div data-testid="station-meta" data-station={props.stationName} />
  ),
}));
vi.mock("@/components/StationFacilities", () => ({
  StationFacilities: (props: { stationName: string }) => (
    <div data-testid="station-facilities" data-station={props.stationName} />
  ),
}));
vi.mock("@/components/SeoulMetroFacilities", () => ({
  SeoulMetroFacilities: (props: { stationName: string }) => (
    <div data-testid="seoul-metro-facilities" data-station={props.stationName} />
  ),
}));

import { MessageBubble } from "../MessageBubble";
import type { Place } from "@/lib/types";

/** 최소 Place fixture */
const placeFixture: Place = {
  id: "p1",
  name: "길동 카페",
  category: "카페",
  address: "강동구 길동",
  roadAddress: "강동구 길동로 1",
  lat: 37.5,
  lng: 127.1,
};

describe("MessageBubble", () => {
  it("사용자 메시지 텍스트 표시", () => {
    render(<MessageBubble message={{ id: "1", role: "user", text: "안녕" }} />);
    expect(screen.getByText("안녕")).toBeTruthy();
  });

  it("사용자 메시지는 heading(level 2) — 회전자 턴별 탐색 앵커", () => {
    render(<MessageBubble message={{ id: "1", role: "user", text: "안녕" }} />);
    const heading = screen.getByRole("heading", { level: 2, name: "안녕" });
    // 프로그램적 포커스만 받고 Tab 순회엔 끼지 않는다.
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("assistant 산문은 heading이 아님(질문만 heading)", () => {
    render(
      <MessageBubble message={{ id: "2", role: "assistant", text: "찾았어요" }} />
    );
    expect(screen.getByText("찾았어요")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "찾았어요" })).toBeNull();
  });

  it("places renders면 장소명 노출", () => {
    render(
      <MessageBubble
        message={{
          id: "3",
          role: "assistant",
          text: "결과",
          renders: [{ type: "places", places: [placeFixture] }],
        }}
      />
    );
    expect(screen.getByText(/길동 카페/)).toBeTruthy();
  });

  it("addresses renders면 roadAddr 노출", () => {
    render(
      <MessageBubble
        message={{
          id: "4",
          role: "assistant",
          text: "주소 결과",
          renders: [
            {
              type: "addresses",
              results: [
                {
                  roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
                  roadAddrPart1: "서울특별시 중구 세종대로 110",
                  jibunAddr: "서울특별시 중구 태평로1가 31",
                  engAddr: "110 Sejong-daero, Jung-gu, Seoul",
                  zipNo: "04524",
                  bdNm: "서울특별시청",
                },
              ],
            },
          ],
        }}
      />
    );
    // AddressResultList가 roadAddr을 렌더링
    expect(screen.getByText(/세종대로 110/)).toBeTruthy();
  });

  // self-fetch nearby 컴포넌트 마운트 테스트 (mock 경유)
  it("subway-nearby renders면 SubwayArrivalsNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "5", role: "assistant", text: "", renders: [{ type: "subway-nearby" }] }}
      />
    );
    expect(screen.getByTestId("subway-nearby")).toBeTruthy();
  });

  it("clinics-nearby renders면 NightClinicsNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "6", role: "assistant", text: "", renders: [{ type: "clinics-nearby" }] }}
      />
    );
    expect(screen.getByTestId("clinics-nearby")).toBeTruthy();
  });

  it("kids-nearby renders면 KidsPlacesNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "7", role: "assistant", text: "", renders: [{ type: "kids-nearby" }] }}
      />
    );
    expect(screen.getByTestId("kids-nearby")).toBeTruthy();
  });

  it("surroundings-nearby renders면 SurroundingsNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "8", role: "assistant", text: "", renders: [{ type: "surroundings-nearby" }] }}
      />
    );
    expect(screen.getByTestId("surroundings-nearby")).toBeTruthy();
  });

  // 좌표 도구 3종 컴포넌트 마운트 테스트
  it("bus current renders면 BusArrivals mode=current 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "9", role: "assistant", text: "", renders: [{ type: "bus", mode: "current" }] }}
      />
    );
    const el = screen.getByTestId("bus-arrivals");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-mode")).toBe("current");
  });

  it("bus place renders면 BusArrivals mode=place 마운트", () => {
    render(
      <MessageBubble
        message={{
          id: "10",
          role: "assistant",
          text: "",
          renders: [{ type: "bus", mode: "place", lat: 37.5, lng: 127.1 }],
        }}
      />
    );
    const el = screen.getByTestId("bus-arrivals");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-mode")).toBe("place");
  });

  it("bike current renders면 BikeStations mode=current 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "11", role: "assistant", text: "", renders: [{ type: "bike", mode: "current" }] }}
      />
    );
    const el = screen.getByTestId("bike-stations");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-mode")).toBe("current");
  });

  it("bike place renders면 BikeStations mode=place 마운트", () => {
    render(
      <MessageBubble
        message={{
          id: "12",
          role: "assistant",
          text: "",
          renders: [{ type: "bike", mode: "place", lat: 37.5, lng: 127.1 }],
        }}
      />
    );
    const el = screen.getByTestId("bike-stations");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-mode")).toBe("place");
  });

  it("air-quality renders면 AirQuality lat/lng 마운트", () => {
    render(
      <MessageBubble
        message={{
          id: "13",
          role: "assistant",
          text: "",
          renders: [{ type: "air-quality", lat: 37.5, lng: 127.1 }],
        }}
      />
    );
    const el = screen.getByTestId("air-quality");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-lat")).toBe("37.5");
    expect(el.getAttribute("data-lng")).toBe("127.1");
  });

  // 역명 도구 2종 컴포넌트 마운트 테스트
  it("station-meta renders면 StationMeta stationName prop으로 마운트", () => {
    render(
      <MessageBubble
        message={{
          id: "14",
          role: "assistant",
          text: "",
          renders: [{ type: "station-meta", stationName: "강남" }],
        }}
      />
    );
    const el = screen.getByTestId("station-meta");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-station")).toBe("강남");
  });

  // dest 도구 2종 컴포넌트 마운트 테스트
  it("car-route renders면 CarRouteBriefing dest prop으로 마운트", () => {
    render(
      <MessageBubble
        message={{
          id: "16",
          role: "assistant",
          text: "",
          renders: [
            {
              type: "car-route",
              dest: { lat: 37.5, lng: 127.1, name: "강남역" },
            },
          ],
        }}
      />
    );
    const el = screen.getByTestId("car-route-briefing");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-dest-name")).toBe("강남역");
    expect(el.getAttribute("data-dest-lat")).toBe("37.5");
    expect(el.getAttribute("data-dest-lng")).toBe("127.1");
  });

  it("transit-route renders면 TransitRouteBriefing dest prop으로 마운트", () => {
    render(
      <MessageBubble
        message={{
          id: "17",
          role: "assistant",
          text: "",
          renders: [
            {
              type: "transit-route",
              dest: { lat: 37.6, lng: 127.2, name: "서울역" },
            },
          ],
        }}
      />
    );
    const el = screen.getByTestId("transit-route-briefing");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-dest-name")).toBe("서울역");
    expect(el.getAttribute("data-dest-lat")).toBe("37.6");
    expect(el.getAttribute("data-dest-lng")).toBe("127.2");
  });

  it("station-facilities renders면 StationFacilities + SeoulMetroFacilities 모두 마운트", () => {
    render(
      <MessageBubble
        message={{
          id: "15",
          role: "assistant",
          text: "",
          renders: [{ type: "station-facilities", stationName: "서울역" }],
        }}
      />
    );
    const sf = screen.getByTestId("station-facilities");
    const smf = screen.getByTestId("seoul-metro-facilities");
    expect(sf).toBeTruthy();
    expect(sf.getAttribute("data-station")).toBe("서울역");
    expect(smf).toBeTruthy();
    expect(smf.getAttribute("data-station")).toBe("서울역");
  });
});
