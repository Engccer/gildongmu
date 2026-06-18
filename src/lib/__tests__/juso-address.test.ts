import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeJusoResults,
  extractEnglishAddressJuso,
  geocodeEnglishAddressJuso,
} from "../providers/juso-address";
import type { JusoAddress } from "../types";

/**
 * 행안부 juso 도로명주소 검색 — 실응답 구조(2026-06-19 실호출 확정):
 * results.common.errorCode "0"=정상(무결과도 "0"+totalCount "0"),
 * results.juso[]에 roadAddr·roadAddrPart1·jibunAddr·engAddr·zipNo·bdNm.
 */
function ok(
  juso: Array<{
    roadAddr: string;
    roadAddrPart1: string;
    jibunAddr: string;
    engAddr: string;
    zipNo: string;
    bdNm: string;
  }>,
) {
  return {
    results: {
      common: {
        errorCode: "0",
        errorMessage: "정상",
        totalCount: String(juso.length),
        currentPage: "1",
        countPerPage: "10",
      },
      juso,
    },
  };
}

const RAW = {
  roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
  roadAddrPart1: "서울특별시 중구 세종대로 110",
  jibunAddr: "서울특별시 중구 태평로1가 31",
  engAddr: "110 Sejong-daero, Jung-gu, Seoul",
  zipNo: "04524",
  bdNm: "서울특별시청",
};

describe("normalizeJusoResults", () => {
  it("정상 응답을 JusoAddress[]로 정규화한다", () => {
    const [a] = normalizeJusoResults(ok([RAW]));
    expect(a.roadAddr).toBe("서울특별시 중구 세종대로 110 (태평로1가)");
    expect(a.roadAddrPart1).toBe("서울특별시 중구 세종대로 110");
    expect(a.engAddr).toBe("110 Sejong-daero, Jung-gu, Seoul");
    expect(a.zipNo).toBe("04524");
    expect(a.bdNm).toBe("서울특별시청");
  });

  it("무결과(errorCode 0 + 빈 juso)는 빈 배열", () => {
    expect(normalizeJusoResults(ok([]))).toEqual([]);
  });

  it("juso가 null이어도 빈 배열로 처리한다", () => {
    const raw = ok([]);
    (raw.results as { juso: unknown }).juso = null;
    expect(normalizeJusoResults(raw)).toEqual([]);
  });

  it("errorCode가 0이 아니면 throw한다", () => {
    const raw = ok([]);
    raw.results.common.errorCode = "E0005";
    raw.results.common.errorMessage = "검색어가 너무 짧습니다.";
    expect(() => normalizeJusoResults(raw)).toThrow();
  });
});

describe("extractEnglishAddressJuso (throw 안 함)", () => {
  it("첫 결과의 engAddr를 반환한다", () => {
    expect(extractEnglishAddressJuso(ok([RAW]))).toBe(
      "110 Sejong-daero, Jung-gu, Seoul",
    );
  });

  it("무결과면 null", () => {
    expect(extractEnglishAddressJuso(ok([]))).toBeNull();
  });

  it("engAddr가 빈 문자열이면 null", () => {
    expect(extractEnglishAddressJuso(ok([{ ...RAW, engAddr: "" }]))).toBeNull();
  });

  it("errorCode가 0이 아니어도 throw하지 않고 null", () => {
    const raw = ok([]);
    raw.results.common.errorCode = "E0001";
    expect(extractEnglishAddressJuso(raw)).toBeNull();
  });
});

describe("geocodeEnglishAddressJuso (실패는 throw하지 않고 graceful null)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 응답이면 영문 주소를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ok([RAW])), { status: 200 })),
    );
    expect(await geocodeEnglishAddressJuso("세종대로 110")).toBe(
      "110 Sejong-daero, Jung-gu, Seoul",
    );
  });

  it("HTTP 에러는 throw하지 않고 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    expect(await geocodeEnglishAddressJuso("세종대로 110")).toBeNull();
  });

  it("네트워크 예외도 null로 흡수한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await geocodeEnglishAddressJuso("세종대로 110")).toBeNull();
  });

  it("빈 주소는 호출 없이 null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await geocodeEnglishAddressJuso("  ")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
