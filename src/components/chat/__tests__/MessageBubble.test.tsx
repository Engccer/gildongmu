// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

  it("assistant 산문 표시", () => {
    render(
      <MessageBubble message={{ id: "2", role: "assistant", text: "찾았어요" }} />
    );
    expect(screen.getByText("찾았어요")).toBeTruthy();
  });

  it("places render면 장소명 노출", () => {
    render(
      <MessageBubble
        message={{
          id: "3",
          role: "assistant",
          text: "결과",
          render: { type: "places", places: [placeFixture] },
        }}
      />
    );
    expect(screen.getByText(/길동 카페/)).toBeTruthy();
  });

  it("addresses render면 roadAddr 노출", () => {
    render(
      <MessageBubble
        message={{
          id: "4",
          role: "assistant",
          text: "주소 결과",
          render: {
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
        }}
      />
    );
    // AddressResultList가 roadAddr을 렌더링
    expect(screen.getByText(/세종대로 110/)).toBeTruthy();
  });

  // self-fetch nearby 컴포넌트 마운트 테스트 (mock 경유)
  it("subway-nearby render면 SubwayArrivalsNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "5", role: "assistant", text: "", render: { type: "subway-nearby" } }}
      />
    );
    expect(screen.getByTestId("subway-nearby")).toBeTruthy();
  });

  it("clinics-nearby render면 NightClinicsNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "6", role: "assistant", text: "", render: { type: "clinics-nearby" } }}
      />
    );
    expect(screen.getByTestId("clinics-nearby")).toBeTruthy();
  });

  it("kids-nearby render면 KidsPlacesNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "7", role: "assistant", text: "", render: { type: "kids-nearby" } }}
      />
    );
    expect(screen.getByTestId("kids-nearby")).toBeTruthy();
  });

  it("surroundings-nearby render면 SurroundingsNearby 마운트", () => {
    render(
      <MessageBubble
        message={{ id: "8", role: "assistant", text: "", render: { type: "surroundings-nearby" } }}
      />
    );
    expect(screen.getByTestId("surroundings-nearby")).toBeTruthy();
  });
});
