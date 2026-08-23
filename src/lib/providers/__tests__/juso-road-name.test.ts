import { describe, expect, it, vi } from "vitest";

// `unstable_cache`는 테스트 환경에서 통과 래퍼로 둔다 — 캐시 자체가 아니라 봉투 판정이 대상이다.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("../../env", async (orig) => ({
  ...(await orig<typeof import("../../env")>()),
  hasJusoKey: () => true,
}));

import { parseRoadNameEn, roadNameEn } from "../juso-road-name";

describe("parseRoadNameEn", () => {
  it("선행 건물번호 토큰 하나만 벗긴다", () => {
    expect(parseRoadNameEn("975 Cheonho-daero, Gangdong-gu, Seoul")).toBe("Cheonho-daero");
    expect(parseRoadNameEn("2-1 Jinhwangdo-ro, Gangdong-gu, Seoul")).toBe("Jinhwangdo-ro");
  });

  it("번호 토큰은 순수 숫자가 아닐 수 있다(실측 B102)", () => {
    expect(parseRoadNameEn("B102 Bongeunsa-ro, Gangnam-gu, Seoul")).toBe("Bongeunsa-ro");
  });

  it("이름 안의 번호(6-gil)는 남긴다 — 첫 토큰만 벗기기 때문", () => {
    expect(parseRoadNameEn("11 Seongnae-ro 6-gil, Gangdong-gu, Seoul")).toBe("Seongnae-ro 6-gil");
  });

  it("번호가 없으면 그대로", () => {
    expect(parseRoadNameEn("Cheonho-daero, Gangdong-gu, Seoul")).toBe("Cheonho-daero");
  });

  it("빈 값·번호만 있는 값은 null", () => {
    expect(parseRoadNameEn("")).toBeNull();
    expect(parseRoadNameEn("975 ")).toBeNull();
  });
});

describe("roadNameEn 봉투 판정", () => {
  // ⚠ juso는 키 만료·미승인에서도 HTTP 200을 준다(fetchDataGoKrJson·readSeoulOpenJson 동형).
  // res.ok만 보면 그 실패가 "도로명 없음"으로 30일 캐시에 눌러앉는다.
  it("200 + errorCode != 0은 throw다 — 실패를 '도로명 없음'으로 캐시하지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: { common: { errorCode: "E0001", errorMessage: "승인되지 않은 KEY 입니다." }, juso: null },
        }),
      })),
    );
    await expect(roadNameEn("천호대로")).rejects.toThrow(/E0001/);
    vi.unstubAllGlobals();
  });

  it("정상 봉투에서 rn 정확 일치만 채택한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: {
            common: { errorCode: "0" },
            juso: [
              { rn: "천호대로157길", engAddr: "6 Cheonho-daero 157-gil, Gangdong-gu, Seoul" },
              { rn: "천호대로", engAddr: "975 Cheonho-daero, Gangdong-gu, Seoul" },
            ],
          },
        }),
      })),
    );
    expect(await roadNameEn("천호대로")).toBe("Cheonho-daero");
    vi.unstubAllGlobals();
  });

  it("0건이면 null이다(일반명사 — 차단 목록을 코드에 박지 않는 근거)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ results: { common: { errorCode: "0", errorMessage: "정상" }, juso: null } }),
      })),
    );
    expect(await roadNameEn("보행자도로")).toBeNull();
    vi.unstubAllGlobals();
  });
});
