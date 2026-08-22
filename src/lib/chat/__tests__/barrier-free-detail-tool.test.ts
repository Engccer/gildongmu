import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionContext } from "../types";

vi.mock("@/lib/providers/tour-barrier-free", () => ({
  getBarrierFreeDetail: vi.fn(),
  searchBarrierFreeNearby: vi.fn(),
}));

import { executeFunction } from "../router";
import { getBarrierFreeDetail } from "@/lib/providers/tour-barrier-free";

const mockDetail = vi.mocked(getBarrierFreeDetail);
const ctx: ExecutionContext = { locale: "ko", dataLocale: "ko" };

const DETAIL = {
  contentId: "126508",
  name: "경복궁",
  facilities: [{ key: "wheelchair", label: "휠체어 대여", value: "안내소에서 대여 가능" }],
};

describe("get_barrier_free_detail (채팅 도구, K3 ⑦)", () => {
  beforeEach(() => {
    mockDetail.mockReset();
    mockDetail.mockResolvedValue(DETAIL);
  });

  it("contentId로 조회하고 상세를 그대로 넘긴다 — 카드 없음, 출처 TourAPI", async () => {
    const r = await executeFunction("get_barrier_free_detail", { contentId: "126508" }, ctx);
    expect(mockDetail).toHaveBeenCalledWith("126508");
    expect(r.data).toEqual({ detail: DETAIL });
    expect(r.render).toBeUndefined();
    expect(r.source).toEqual([{ label: "source.tourapi" }]);
  });

  it("빈 name은 싣지 않는다 — detailWithTour2가 title을 주지 않는다(실호출)", async () => {
    mockDetail.mockResolvedValue({ ...DETAIL, name: "" });
    const r = await executeFunction("get_barrier_free_detail", { contentId: "126508" }, ctx);
    expect(r.data).toEqual({ detail: { contentId: "126508", facilities: DETAIL.facilities } });
  });

  it("항목 없음은 detail:null — 빈 facilities와 구분", async () => {
    mockDetail.mockResolvedValue(null);
    const r = await executeFunction("get_barrier_free_detail", { contentId: "0" }, ctx);
    expect(r.data).toEqual({ detail: null });
  });

  it("contentId가 비면 upstream을 부르지 않는다", async () => {
    const r = await executeFunction("get_barrier_free_detail", {}, ctx);
    expect(mockDetail).not.toHaveBeenCalled();
    expect((r.data as { error?: string }).error).toBeTruthy();
  });
});
