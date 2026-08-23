import { beforeEach, describe, expect, it, vi } from "vitest";

const tmap = vi.hoisted(() => vi.fn());
const kakao = vi.hoisted(() => vi.fn());
const roads = vi.hoisted(() => vi.fn());
const audio = vi.hoisted(() => vi.fn());

vi.mock("../providers/tmap-pedestrian", () => ({ getWalkRouteBriefing: tmap }));
vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: kakao }));
vi.mock("../providers/juso-road-name", () => ({ roadNamesEn: roads }));
vi.mock("../providers/audio-signals", () => ({ hasAudioSignalNear: audio }));
vi.mock("../providers/crosswalks", () => ({ matchCrosswalk: () => null }));
vi.mock("../env", async (orig) => ({
  ...(await orig<typeof import("../env")>()),
  hasKakaoKey: () => true,
  hasTmapKey: () => true,
}));

import { attachStepActions, getWalkRoute } from "../walk-route";

const origin = { lat: 37.5, lng: 127.1 };
const dest = { lat: 37.51, lng: 127.11 };

beforeEach(() => {
  tmap.mockReset();
  kakao.mockReset();
  roads.mockReset();
  audio.mockReset();
  audio.mockReturnValue(false);
  roads.mockResolvedValue(new Map([["진황도로", "Jinhwangdo-ro"]]));
});

describe("getWalkRoute lang=en", () => {
  it("Tmap만 부르고 카카오는 부르지 않는다", async () => {
    tmap.mockResolvedValue({
      distanceMeters: 300,
      durationSeconds: 250,
      steps: [
        {
          description: "우회전 후 진황도로를 따라 294m 이동",
          turnType: 13,
          roadNameKo: "진황도로",
          distanceMeters: 294,
          action: "right",
        },
      ],
    });
    const r = await getWalkRoute({ origin, dest, lang: "en" });
    expect(kakao).not.toHaveBeenCalled();
    expect(tmap).toHaveBeenCalledWith(expect.objectContaining({ guard: true }));
    expect(r?.steps[0].description).toBe("Turn right, then walk 294m along Jinhwangdo-ro");
  });

  it("음향신호기 주석 문구가 영어다", async () => {
    audio.mockReturnValue(true);
    tmap.mockResolvedValue({
      distanceMeters: 30,
      durationSeconds: 30,
      steps: [
        {
          description: "횡단보도 후 14m 이동",
          turnType: 211,
          distanceMeters: 14,
          action: "crosswalk",
          coord: origin,
        },
      ],
    });
    const r = await getWalkRoute({ origin, dest, lang: "en" });
    expect(r?.steps[0].description).toBe(
      "Cross the crosswalk, then walk 14m, audible pedestrian signal",
    );
  });

  it("계단 회피 안내 문장도 영어다", async () => {
    tmap.mockResolvedValue({
      distanceMeters: 30,
      durationSeconds: 30,
      steps: [{ description: "직진 후 14m 이동", turnType: 11, distanceMeters: 14 }],
    });
    const r = await getWalkRoute({ origin, dest, lang: "en", accessible: true });
    expect(r?.stepFreeNotice).toMatch(/^Step-free routing is unavailable/);
    expect(r?.steps[0].description).toMatch(/^Step-free routing is unavailable/);
  });
});

describe("getWalkRoute lang=ko", () => {
  it("종전대로 카카오를 먼저 부른다", async () => {
    kakao.mockResolvedValue({
      distanceMeters: 300,
      durationSeconds: 250,
      steps: [{ description: "성내로에서 100m 이동" }],
    });
    await getWalkRoute({ origin, dest, lang: "ko" });
    expect(kakao).toHaveBeenCalled();
    expect(tmap).not.toHaveBeenCalled();
  });

  it("Tmap 폴백도 기하 요청을 전달한다(종전엔 유실)", async () => {
    kakao.mockRejectedValue(new Error("boom"));
    tmap.mockResolvedValue({
      distanceMeters: 30,
      durationSeconds: 30,
      steps: [{ description: "직진 후 14m 이동", turnType: 11, distanceMeters: 14 }],
    });
    await getWalkRoute({ origin, dest, lang: "ko", includeGeometry: true });
    expect(tmap).toHaveBeenCalledWith(
      expect.objectContaining({ includeLineGeometry: true, noStore: true, guard: false }),
    );
  });
});

describe("attachStepActions", () => {
  it("기하 응답에는 카카오 스텝에도 행동을 채운다", () => {
    const out = attachStepActions(
      {
        distanceMeters: 1,
        durationSeconds: 1,
        steps: [{ description: "메가커피 앞에서 왼쪽으로 돌아 40m 이동" }],
      },
      true,
    );
    expect(out.steps[0].action).toBe("left");
  });

  it("비기하 응답에서는 행동·turnType·도로명을 전부 뗀다(byte-identical 유지)", () => {
    const out = attachStepActions(
      {
        distanceMeters: 1,
        durationSeconds: 1,
        steps: [{ description: "x", action: "left", turnType: 12, roadNameKo: "천호대로" }],
      },
      false,
    );
    expect(out.steps[0]).toEqual({ description: "x" });
  });

  it("서버 투영 행동이 문장 분류보다 우선한다", () => {
    const out = attachStepActions(
      {
        distanceMeters: 1,
        durationSeconds: 1,
        // 문장은 좌회전인데 구조화는 crosswalk — 구조화가 이긴다.
        steps: [{ description: "왼쪽으로 돌아 10m 이동", action: "crosswalk" }],
      },
      true,
    );
    expect(out.steps[0].action).toBe("crosswalk");
  });
});
