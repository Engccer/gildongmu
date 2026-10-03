// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RouteGuideApi } from "@/hooks/useRouteGuide";

vi.mock("next-intl", async () => {
  const m = await import("./stable-intl-mock");
  return m.stableIntlMock("ko", m.keyOnly);
});
vi.mock("../SurroundingsScene", () => ({ SurroundingsScene: () => null }));

const guideApi: RouteGuideApi = {
  status: "tracking",
  supported: true,
  mode: "detail",
  liveText: "",
  offRoute: false,
  progress: null,
  currentText: null,
  liveRows: { top: null, next: null, crossing: null },
  degradeText: null,
  rerouting: false,
  start: () => {},
  stop: () => {},
  announceProgress: () => {},
  requestReroute: () => {},
};
vi.mock("@/hooks/useRouteGuide", () => ({
  useRouteGuide: () => guideApi,
}));

// 패널·비콘은 자기 live region을 두지 않는다(A40) — 창구 숙주로 감싸 렌더한다.
import { DistanceBeaconHost } from "./live-region-host";

/**
 * 하단 2행 렌더 계약(spec 2026-08-11 §6): 두 행은 live region 밖 정적 텍스트이고,
 * 빈 값은 요소 자체를 제거한다(빈 텍스트 낭독 금지). 행 내용 판정은 공유 fixture
 * (guide-live-rows.test.ts) 몫이라 여기서는 배선만 본다.
 */
describe("DistanceBeacon 하단 2행", () => {
  afterEach(() => {
    cleanup();
    guideApi.liveRows = { top: null, next: null, crossing: null };
    guideApi.currentText = null;
    guideApi.offRoute = false;
  });

  const dest = { lat: 37.5380, lng: 127.1430, name: "목적지 건물" };

  function open() {
    render(<DistanceBeaconHost dest={dest} accessible={false} variant={null} />);
    fireEvent.click(screen.getByRole("button", { name: "walkHeading" }));
  }

  it("두 행이 값 그대로 렌더된다(라이브 리전 아님)", () => {
    guideApi.liveRows = {
      top: "빵집까지 52m 직진하세요",
      next: "다음 안내, 횡단보도를 건너세요",
      crossing: null,
    };
    open();
    const top = screen.getByText("빵집까지 52m 직진하세요");
    const next = screen.getByText("다음 안내, 횡단보도를 건너세요");
    expect(top.getAttribute("aria-live")).toBeNull();
    expect(next.getAttribute("aria-live")).toBeNull();
  });

  it("빈 값은 요소 제거 — 아랫줄만 비어도 그 행은 없다", () => {
    guideApi.liveRows = { top: "목적지까지 5m 직진하세요", next: null, crossing: null };
    open();
    expect(screen.getByText("목적지까지 5m 직진하세요")).toBeTruthy();
    expect(screen.queryByText(/다음 안내/)).toBeNull();
  });

  it("현재 도로 행(car, E56)은 세 줄의 맨 앞이고 live region이 아니다", () => {
    guideApi.currentText = "현재 도로, 올림픽대로";
    guideApi.liveRows = { top: "200m 후 우회전하세요", next: "다음 안내, 좌회전하세요", crossing: null };
    open();
    const road = screen.getByText("현재 도로, 올림픽대로");
    const top = screen.getByText("200m 후 우회전하세요");
    const next = screen.getByText("다음 안내, 좌회전하세요");
    expect(road.getAttribute("aria-live")).toBeNull();
    // 읽기 순서 = DOM 순서(iOS 시트와 같은 ① → ② → ③).
    expect(road.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(top.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("이탈 중에는 현재 도로 행을 숨긴다(경로 밖에서는 어느 도로인지 모른다)", () => {
    guideApi.currentText = "현재 도로, 올림픽대로";
    guideApi.offRoute = true;
    open();
    expect(screen.queryByText("현재 도로, 올림픽대로")).toBeNull();
  });
});
