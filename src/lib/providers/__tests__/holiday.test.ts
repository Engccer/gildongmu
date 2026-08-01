import { describe, it, expect, vi, afterEach } from "vitest";

// env는 import 시점에 process.env로 동결되므로, fetchIsHoliday의 키 유무
// 분기를 테스트하려면 env 모듈을 모킹해 키를 주입한다(provider __tests__는
// __tests__/에서 두 단계 위 src/lib/env.ts를 가리키므로 "../../env").
vi.mock("../../env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

import { fetchIsHoliday } from "../holiday";

function ok(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as unknown as Response;
}

describe("fetchIsHoliday", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("200+정상(resultCode 00)+items:'' → false(그 달 공휴일 없음)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ response: { header: { resultCode: "00" }, body: { items: "" } } })),
    );
    await expect(fetchIsHoliday("20260101")).resolves.toBe(false);
  });

  it("200+정상+해당일 isHoliday Y → true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok({
          response: {
            header: { resultCode: "00" },
            body: { items: { item: [{ locdate: "20260101", isHoliday: "Y" }] } },
          },
        }),
      ),
    );
    await expect(fetchIsHoliday("20260101")).resolves.toBe(true);
  });

  it("200+정상+다른 날짜만 공휴일 → false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok({
          response: {
            header: { resultCode: "00" },
            body: { items: { item: [{ locdate: "20260105", isHoliday: "Y" }] } },
          },
        }),
      ),
    );
    await expect(fetchIsHoliday("20260101")).resolves.toBe(false);
  });

  it("200+비정상 envelope(resultCode 미신청·오류) → null(판정 불가), false와 구분", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok({ response: { header: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } }),
      ),
    );
    await expect(fetchIsHoliday("20260101")).resolves.toBeNull();
  });

  it("200+header 자체가 없는 기형 envelope → null(판정 불가)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ response: { body: { items: "" } } })));
    await expect(fetchIsHoliday("20260101")).resolves.toBeNull();
  });

  it("HTTP 비정상(!res.ok) → null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }) as unknown as Response));
    await expect(fetchIsHoliday("20260101")).resolves.toBeNull();
  });

  it("fetch 자체 실패(네트워크) → null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchIsHoliday("20260101")).resolves.toBeNull();
  });

  it("키 없음 → fetch 호출 없이 null", async () => {
    vi.resetModules();
    vi.doMock("../../env", () => ({ env: { DATA_GO_KR_API_KEY: "" } }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../holiday");
    await expect(mod.fetchIsHoliday("20260101")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.doUnmock("../../env");
  });
});
