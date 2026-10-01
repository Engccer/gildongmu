import { describe, expect, it, vi } from "vitest";

// 탐침은 카카오만 부른다(Tmap 폴백 없음, 설계 리뷰 M5). 카카오 provider만 모킹하고 재작성·행동 투영은 실물로 태운다 —
// 원문 문형("…에서 왼쪽길로 80m 이동")이 도보 안내와 같은 분류(`left`)로 잡히는지가 이 테스트의 축이다.
vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: vi.fn() }));
vi.mock("../providers/tmap-pedestrian", () => ({
  getWalkRouteBriefing: vi.fn(() => {
    throw new Error("탐침이 Tmap을 불렀다");
  }),
}));

import { getWalkProbe } from "../walk-probe";
import { getKakaoWalkBriefing } from "../providers/kakao-walk";

const pts = (list: Array<[number, number]>) => list.map(([lat, lng]) => ({ lat, lng }));

describe("getWalkProbe", () => {
  it("카카오 SHORTEST·원좌표·no-store로 한 번 묻고, 원문 횡단보도·회전 문형을 분류한다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValueOnce({
      distanceMeters: 180,
      durationSeconds: 150,
      steps: [
        { description: "카페까지 횡단보도 이용", distanceMeters: 20, pathCoords: pts([[37.5, 127.0], [37.5002, 127.0]]) },
        { description: "약국에서 왼쪽길로 80m 이동(천호대로193길)", distanceMeters: 80, pathCoords: pts([[37.5002, 127.0], [37.5002, 126.999]]) },
        { description: "공원까지 64m 이동(명일로)", distanceMeters: 64, pathCoords: pts([[37.5002, 126.999], [37.5008, 126.999]]) },
      ],
    });
    const probe = await getWalkProbe(37.5, 127.0, 0);
    const call = vi.mocked(getKakaoWalkBriefing).mock.calls[0][0];
    expect(call).toMatchObject({ origin: { lat: 37.5, lng: 127.0 }, routeMode: "SHORTEST", preciseCoords: true, noStore: true });
    expect(probe.crosswalks).toEqual([{ lat: 37.5, lng: 127.0 }]);
    expect(probe.turns.map((t) => [t.lat, t.lng])).toEqual([[37.5002, 127.0]]);
  });

  it("경로 없음(null)은 빈 목록", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValueOnce(null);
    expect(await getWalkProbe(37.5, 127.0, 90)).toEqual({ crosswalks: [], turns: [] });
  });
});
