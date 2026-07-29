import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/tmap-car", () => ({ getTmapCarBriefing: vi.fn() }));
vi.mock("../providers/kakao-navi", () => ({ getCarRouteBriefing: vi.fn() }));
vi.mock("../env", () => ({ hasKakaoKey: vi.fn(() => true), hasTmapKey: vi.fn(() => true) }));

import { getTmapCarBriefing } from "../providers/tmap-car";
import { getCarRouteBriefing } from "../providers/kakao-navi";
import { hasKakaoKey, hasTmapKey } from "../env";
import { getCarRoute } from "../car-route";
import type { CarRouteBriefing } from "../types";

const COORDS = { origin: { lat: 37.538, lng: 127.1435 }, dest: { lat: 37.4979, lng: 127.0276 } };
const TMAP_BRIEFING: CarRouteBriefing = {
  distanceMeters: 18651, durationSeconds: 2713, taxiFare: 21300, tollFare: 0,
  guides: [{ name: "", guidance: "교차로에서 우회전 후 명일로를 따라 244m 이동", distanceMeters: 0, durationSeconds: 0 }],
};
const KAKAO_BRIEFING: CarRouteBriefing = {
  distanceMeters: 18700, durationSeconds: 2800, taxiFare: 21500, tollFare: 0,
  guides: [{ name: "", guidance: "우회전", distanceMeters: 228, durationSeconds: 40 }],
};

describe("getCarRoute", () => {
  beforeEach(() => {
    vi.mocked(hasKakaoKey).mockReturnValue(true);
    vi.mocked(hasTmapKey).mockReturnValue(true);
    // mockReset으로 이전 테스트의 호출 이력을 지운다(walk-route.test.ts 동형) —
    // 안 지우면 "not toHaveBeenCalled" 단언이 이전 테스트 호출을 오염 상속한다.
    vi.mocked(getTmapCarBriefing).mockReset().mockResolvedValue(TMAP_BRIEFING);
    vi.mocked(getCarRouteBriefing).mockReset().mockResolvedValue(KAKAO_BRIEFING);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("両키 정상이면 Tmap 결과를 쓰고 카카오는 호출하지 않는다", async () => {
    await expect(getCarRoute(COORDS)).resolves.toEqual(TMAP_BRIEFING);
    expect(getCarRouteBriefing).not.toHaveBeenCalled();
  });

  it("Tmap throw + 카카오 키 있음 → 카카오 폴백 + 폴백 경고 로그", async () => {
    vi.mocked(getTmapCarBriefing).mockRejectedValue(new Error("HTTP 500"));
    await expect(getCarRoute(COORDS)).resolves.toEqual(KAKAO_BRIEFING);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("Tmap throw + 카카오 키 없음 → 원래 오류 rethrow", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    vi.mocked(getTmapCarBriefing).mockRejectedValue(new Error("HTTP 500"));
    await expect(getCarRoute(COORDS)).rejects.toThrow("HTTP 500");
  });

  it("Tmap 키 없음 + 카카오 키 있음 → 카카오 직행(폴백 로그 없음)", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    await expect(getCarRoute(COORDS)).resolves.toEqual(KAKAO_BRIEFING);
    expect(getTmapCarBriefing).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("両키 없음 → throw(게이트 이중 방어)", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    await expect(getCarRoute(COORDS)).rejects.toThrow();
  });
});
