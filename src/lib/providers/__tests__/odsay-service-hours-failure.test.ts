import { afterEach, describe, expect, it, vi } from "vitest";

// env는 키 보유 상태로 고정한다(게이트 때문에 조회가 건너뛰어지면 실패 격리를 검증할 수 없다).
vi.mock("../../env", () => ({
  env: { ODSAY_API_KEY: "test-odsay-key", DATA_GO_KR_API_KEY: "test-datagokr-key" },
}));

import { getTransitRoute } from "../odsay";

/**
 * spec "테스트·검증 계획"의 실패 격리 항목.
 *
 * 운행시간은 부가 정보다. TOPIS·TAGO 조회가 어떤 식으로 실패하든 경로 응답 자체는
 * 살아 있어야 하고 순위도 원본(ODsay 추천순) 그대로여야 한다. 이 축이 비어 있으면
 * 이후 누가 Promise.allSettled를 Promise.all로 바꾸거나 fetch 예외를 못 잡게
 * 리팩터링해도 어떤 테스트도 잡지 못한다(브랜치 리뷰 지적, 2026-08-01).
 */

// ODsay 최소 응답: 버스 3개 대안(추천 342 → 대안 370 → 대안 30-3)
const ODSAY_BODY = {
  result: {
    path: [
      makePath("342", "124000038"),
      makePath("370", "100100061"),
      makePath("30-3", "227000006"),
    ],
  },
};

function makePath(busNo: string, blID: string) {
  return {
    pathType: 2,
    info: {
      totalTime: 22,
      payment: 1500,
      totalWalk: 300,
      firstStartStation: "출발",
      lastEndStation: "도착",
    },
    subPath: [
      {
        trafficType: 2,
        sectionTime: 18,
        stationCount: 10,
        startName: "출발정류장",
        endName: "도착정류장",
        lane: [{ busNo, busLocalBlID: blID, busCityCode: 1000 }],
      },
    ],
  };
}

const ORIGIN = { lat: 37.5358819, lng: 127.1323963 };
const DEST = { lat: 37.5408157, lng: 127.1554188 };

/** ODsay만 성공시키고 운행시간 조회(TOPIS·TAGO)는 주어진 방식으로 실패시킨다. */
function stubFetch(failMode: "reject" | "500" | "badJson") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input instanceof URL ? input.href : input);
      if (url.includes("api.odsay.com")) {
        return new Response(JSON.stringify(ODSAY_BODY), { status: 200 });
      }
      // ws.bus.go.kr(TOPIS) · apis.data.go.kr(TAGO)
      if (failMode === "reject") throw new Error("network down");
      if (failMode === "500") return new Response("upstream error", { status: 500 });
      return new Response("<html>not json</html>", { status: 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("운행시간 조회 실패 격리", () => {
  for (const mode of ["reject", "500", "badJson"] as const) {
    it(`${mode}: 경로 3건이 원순서 그대로 반환되고 전부 unknown이다`, async () => {
      stubFetch(mode);
      const result = await getTransitRoute({ origin: ORIGIN, dest: DEST });

      expect(result).not.toBeNull();
      const routes = [result!.recommended, ...result!.alternatives];
      // 부가 정보 실패가 본 기능을 죽이지 않는다
      expect(routes).toHaveLength(3);
      // ODsay 추천순이 흔들리지 않는다(강등 근거가 없으므로 재정렬도 없어야 한다)
      expect(routes.map((r) => r.legs[0].lineName)).toEqual(["342", "370", "30-3"]);
      // 실패를 running·outside 어느 쪽으로도 단정하지 않는다(3-state)
      for (const r of routes) {
        expect(r.legs[0].serviceStatus).toBe("unknown");
        expect(r.legs[0].firstServiceTime).toBeUndefined();
        expect(r.legs[0].lastServiceTime).toBeUndefined();
      }
    });
  }

  it("ODsay 자체 실패는 그대로 throw한다(부가 정보 실패와 구분)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("odsay down", { status: 500 })),
    );
    await expect(getTransitRoute({ origin: ORIGIN, dest: DEST })).rejects.toThrow();
  });
});
