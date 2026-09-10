// @vitest-environment jsdom
/**
 * 프리필 진입 자동 조회(B10) + 출발지 프리필 착지(E32).
 *
 * 판정 축은 **조회가 몇 번 시작되는가** 하나다. 출발지가 "현재 위치"인 조회는
 * 반드시 측위를 지나므로(`runQuery`의 `awaitEffectiveLocation` → `awaitGeolocation`)
 * 그 호출 수가 곧 조회 수다 — 마운트 때 측위 팝업이 뜨는지를 그대로 재는 축이라
 * B10이 막으려던 회귀(`?dir=` 새로고침마다 팝업)와 같은 좌표계다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { DirEndpoint } from "@/lib/directions-state";
import { awaitGeolocation } from "@/lib/geolocation";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({
  awaitGeolocation: vi.fn(async () => ({ status: "error" as const })),
  getGeolocationSnapshot: () => ({ status: "idle" as const }),
  DIRECTIONS_ORIGIN_MAX_AGE_SECONDS: 180,
}));
vi.mock("../VoiceRecordButton", () => ({ VoiceRecordButton: () => null }));
vi.mock("../TransitRouteBriefing", () => ({ TransitRouteResult: () => null }));
vi.mock("../WalkRouteBriefing", () => ({ WalkRouteResult: () => null }));
vi.mock("../CarRouteBriefing", () => ({ CarRouteResult: () => null }));
vi.mock("../DistanceBeacon", () => ({ DistanceBeacon: () => null }));

import { DirectionsView } from "../DirectionsView";

const gangnam: DirEndpoint = {
  kind: "place",
  label: "강남역",
  coord: { lat: 37.497, lng: 127.027 },
};

function renderView(props: {
  initialFrom?: DirEndpoint;
  initialTo?: DirEndpoint | null;
  prefill?: boolean;
}) {
  return render(
    <DirectionsView
      canShowWalk
      canShowTransit
      canBriefCarRoute
      onBack={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("길찾기 프리필 진입", () => {
  it("도착지 프리필 진입은 마운트에서 조회를 1회 시작한다", async () => {
    renderView({ initialTo: gangnam, prefill: true });
    await waitFor(() => {
      expect(vi.mocked(awaitGeolocation)).toHaveBeenCalledTimes(1);
    });
  });

  it("`?dir=` 복원(같은 필드, 표식 없음)은 조회하지 않는다", async () => {
    renderView({ initialFrom: { kind: "current" }, initialTo: gangnam });
    // 마운트 착지(제목 포커스)까지 기다린 뒤 판정한다 — 조회 effect가 돌 기회를
    // 주지 않고 "안 돌았다"고 단언하면 항상 통과하는 공허한 테스트가 된다.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "title" }),
      );
    });
    expect(vi.mocked(awaitGeolocation)).not.toHaveBeenCalled();
  });

  it("출발지만 채운 프리필은 조회하지 않고 도착지 입력에 착지한다", async () => {
    renderView({ initialFrom: gangnam, prefill: true });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("to"));
    });
    expect(vi.mocked(awaitGeolocation)).not.toHaveBeenCalled();
  });
});
