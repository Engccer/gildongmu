// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RouteGuideApi } from "@/hooks/useRouteGuide";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ko",
}));
vi.mock("../SurroundingsScene", () => ({ SurroundingsScene: () => null }));

const guideApi: RouteGuideApi = {
  status: "tracking",
  supported: true,
  mode: "detail",
  liveText: "",
  offRoute: false,
  progress: null,
  currentText: null,
  liveRows: { top: null, next: null },
  canOfferDetail: false,
  rerouting: false,
  start: () => {},
  stop: () => {},
  toggleMode: () => {},
  announceProgress: () => {},
  requestReroute: () => {},
};
vi.mock("@/hooks/useRouteGuide", () => ({
  useRouteGuide: () => guideApi,
}));

import { DistanceBeacon } from "../DistanceBeacon";

/**
 * 하단 2행 렌더 계약(spec 2026-08-11 §6): 두 행은 live region 밖 정적 텍스트이고,
 * 빈 값은 요소 자체를 제거한다(빈 텍스트 낭독 금지). 행 내용 판정은 공유 fixture
 * (guide-live-rows.test.ts) 몫이라 여기서는 배선만 본다.
 */
describe("DistanceBeacon 하단 2행", () => {
  afterEach(() => {
    cleanup();
    guideApi.liveRows = { top: null, next: null };
  });

  const dest = { lat: 37.5380, lng: 127.1430, name: "주택 A" };

  function open() {
    render(<DistanceBeacon dest={dest} accessible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "walkHeading" }));
  }

  it("두 행이 값 그대로 렌더된다(라이브 리전 아님)", () => {
    guideApi.liveRows = {
      top: "파리바게뜨까지 52m 직진하세요",
      next: "다음 안내, 횡단보도를 건너세요",
    };
    open();
    const top = screen.getByText("파리바게뜨까지 52m 직진하세요");
    const next = screen.getByText("다음 안내, 횡단보도를 건너세요");
    expect(top.getAttribute("aria-live")).toBeNull();
    expect(next.getAttribute("aria-live")).toBeNull();
  });

  it("빈 값은 요소 제거 — 아랫줄만 비어도 그 행은 없다", () => {
    guideApi.liveRows = { top: "목적지까지 5m 직진하세요", next: null };
    open();
    expect(screen.getByText("목적지까지 5m 직진하세요")).toBeTruthy();
    expect(screen.queryByText(/다음 안내/)).toBeNull();
  });
});
