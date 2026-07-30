// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { RouteLinks } from "../RouteLinks";

const base = {
  id: "kakao-21160690",
  name: "강동역 5호선",
  category: "교통,수송 > 지하철,전철 > 수도권5호선",
  address: "서울 강동구 천호동 571-10",
  roadAddress: "서울 강동구 천호대로 지하 1097",
  lat: 37.5357,
  lng: 127.1324,
  link: "http://place.map.kakao.com/21160690",
};

afterEach(cleanup);

describe("RouteLinks 카카오 진입점 단일화", () => {
  it("카카오 장소는 카카오 버튼이 장소 상세(link)를 직접 가리키고 홈페이지 버튼은 없다", () => {
    render(<RouteLinks place={base} />);
    const kakao = screen.getByText("place.openInKakaoMap").closest("a");
    expect(kakao?.getAttribute("href")).toBe(base.link);
    expect(screen.queryByText("place.homepage")).toBeNull();
  });

  it("카카오 장소인데 link가 없으면 좌표 핀 지도로 폴백한다", () => {
    render(<RouteLinks place={{ ...base, link: undefined }} />);
    const kakao = screen.getByText("place.openInKakaoMap").closest("a");
    expect(kakao?.getAttribute("href")).toContain("map.kakao.com/link/map/");
    expect(screen.queryByText("place.homepage")).toBeNull();
  });

  it("비카카오 장소의 link는 홈페이지 버튼으로 남고 카카오 버튼은 핀 지도를 가리킨다", () => {
    const naver = {
      ...base,
      id: "naver-local-0-백년찌개집",
      link: "https://example.com/shop",
    };
    render(<RouteLinks place={naver} />);
    const kakao = screen.getByText("place.openInKakaoMap").closest("a");
    expect(kakao?.getAttribute("href")).toContain("map.kakao.com/link/map/");
    const homepage = screen.getByText("place.homepage").closest("a");
    expect(homepage?.getAttribute("href")).toBe(naver.link);
  });
});
