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
import { loadRecentEndpoints } from "@/lib/recent-searches";
import { markUnwinding } from "@/lib/webmcp/view-registry";

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

function renderView(
  props: {
    initialFrom?: DirEndpoint;
    initialTo?: DirEndpoint | null;
    prefill?: boolean;
  },
  modes: { canShowWalk?: boolean; canShowTransit?: boolean; canBriefCarRoute?: boolean } = {},
) {
  return render(
    <DirectionsView
      canShowWalk={modes.canShowWalk ?? true}
      canShowTransit={modes.canShowTransit ?? true}
      canBriefCarRoute={modes.canBriefCarRoute ?? true}
      onBack={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  markUnwinding(false);
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

// 도구층 언와인드(홈으로 되돌리는 중)에는 마운트 착지를 하지 않는 것이 계약인데
// (spec §6.1), 조회는 종단에서 첫 성공 수단 heading으로 포커스를 옮긴다 — 그래서
// 조회 자체가 같은 가드를 받아야 제목에서만 지켜지고 결과에서 깨지는 비대칭이 없다.
describe("언와인드 중 프리필 진입", () => {
  it("도구가 홈으로 되돌리는 중이면 프리필 진입도 조회하지 않는다", async () => {
    markUnwinding(true);
    renderView({ initialTo: gangnam, prefill: true });
    // 가드가 없으면 여기서 측위가 시작된다(아래 단언 전에 충분히 돈다).
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "title", level: 2 })).toBeTruthy();
    });
    expect(vi.mocked(awaitGeolocation)).not.toHaveBeenCalled();
  });
});

// 프리필 끝점은 "그 필드의 확정"이므로 같은 스코프에 기록된다 — 출발지 프리필이
// 도착지 목록에 들어가면 다음에 그 장소를 출발지로 고를 때 검색부터 해야 한다.
describe("프리필 끝점의 최근 장소 기록", () => {
  it("도착지 프리필은 도착지 목록에만, 출발지 프리필은 출발지 목록에만 들어간다", async () => {
    renderView({ initialTo: gangnam, prefill: true });
    await waitFor(() => {
      expect(loadRecentEndpoints("to").map((e) => e.label)).toEqual(["강남역"]);
    });
    expect(loadRecentEndpoints("from")).toEqual([]);

    cleanup();
    localStorage.clear();

    renderView({ initialFrom: gangnam, prefill: true });
    await waitFor(() => {
      expect(loadRecentEndpoints("from").map((e) => e.label)).toEqual(["강남역"]);
    });
    expect(loadRecentEndpoints("to")).toEqual([]);
  });
});

// 자동 조회 진입의 착지는 둘이다 — 마운트 제목, 그리고 결과가 오면 첫 성공 수단
// heading. 최종 커서가 수단 heading이어야 "조회까지가 한 동작"이 성립한다.
describe("자동 조회 진입의 최종 착지", () => {
  it("조회가 성공하면 커서가 제목이 아니라 수단 heading에 있다", async () => {
    vi.mocked(awaitGeolocation).mockResolvedValue({
      status: "ready",
      coords: { lat: 37.5, lng: 127.0 },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/route/walk")) {
          return {
            ok: true,
            json: async () => ({ lines: [{ kind: "shortest", route: { distanceMeters: 100, durationSeconds: 90, steps: [] } }] }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderView(
      { initialTo: gangnam, prefill: true },
      { canShowTransit: false, canBriefCarRoute: false },
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "heading", level: 3 }),
      );
    });
  });
});
