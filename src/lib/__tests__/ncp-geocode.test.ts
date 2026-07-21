import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractEnglishAddress,
  geocodeEnglishAddress,
  extractRoadAddress,
  reverseRoadAddress,
} from "../providers/ncp-geocode";

/**
 * NCP Maps Geocoding 응답에서 영문 주소만 뽑는 순수 함수.
 * 실응답 구조 확정(2026-06-13): addresses[0].englishAddress에
 * "161, Sajik-ro, Jongno-gu, Seoul, Republic of Korea" 형태로 온다.
 */
describe("extractEnglishAddress", () => {
  it("addresses[0].englishAddress를 반환한다", () => {
    const res = {
      status: "OK",
      meta: { totalCount: 1 },
      addresses: [
        {
          roadAddress: "서울특별시 종로구 사직로 161 경복궁",
          jibunAddress: "서울특별시 종로구 세종로 1-1 경복궁",
          englishAddress: "161, Sajik-ro, Jongno-gu, Seoul, Republic of Korea",
        },
      ],
    };
    expect(extractEnglishAddress(res)).toBe(
      "161, Sajik-ro, Jongno-gu, Seoul, Republic of Korea",
    );
  });

  it("결과가 없으면 null", () => {
    expect(
      extractEnglishAddress({ status: "OK", meta: { totalCount: 0 }, addresses: [] }),
    ).toBeNull();
  });

  it("englishAddress가 빈 문자열이면 null", () => {
    const res = {
      status: "OK",
      meta: { totalCount: 1 },
      addresses: [{ roadAddress: "x", jibunAddress: "y", englishAddress: "" }],
    };
    expect(extractEnglishAddress(res)).toBeNull();
  });
});

describe("geocodeEnglishAddress (실패는 throw하지 않고 graceful null)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 응답이면 영문 주소를 반환한다", async () => {
    const body = JSON.stringify({
      status: "OK",
      meta: { totalCount: 1 },
      addresses: [
        { roadAddress: "r", jibunAddress: "j", englishAddress: "161, Sajik-ro" },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    expect(await geocodeEnglishAddress("서울 사직로 161")).toBe("161, Sajik-ro");
  });

  it("HTTP 에러는 throw하지 않고 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    expect(await geocodeEnglishAddress("서울 어딘가")).toBeNull();
  });

  it("네트워크 예외도 null로 흡수한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await geocodeEnglishAddress("서울 어딘가")).toBeNull();
  });

  it("빈 주소는 호출 없이 null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await geocodeEnglishAddress("  ")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * NCP 역지오코딩(map-reversegeocode) 응답에서 도로명 주소만 뽑는 순수 함수.
 * 실호출 확정(2026-07-22): 127.1465,37.5354 → status.name "ok",
 * area1 "서울특별시"/area2 "강동구"/area3 "둔촌동", land.name "천호대로"/
 * number1 "1220" → "서울특별시 강동구 천호대로 1220"(area3는 조립에서 제외).
 */
describe("extractRoadAddress", () => {
  it("area1+area2+land.name+land.number1을 공백 조립한다", () => {
    const res = {
      status: { code: 0, name: "ok", message: "done" },
      results: [
        {
          name: "roadaddr",
          region: {
            area1: { name: "서울특별시" },
            area2: { name: "강동구" },
          },
          land: { name: "천호대로", number1: "1220", number2: "" },
        },
      ],
    };
    expect(extractRoadAddress(res)).toBe("서울특별시 강동구 천호대로 1220");
  });

  it("number2가 있으면 '-'로 연결한다", () => {
    const res = {
      status: { code: 0, name: "ok", message: "done" },
      results: [
        {
          name: "roadaddr",
          region: {
            area1: { name: "서울특별시" },
            area2: { name: "종로구" },
          },
          land: { name: "사직로", number1: "161", number2: "3" },
        },
      ],
    };
    expect(extractRoadAddress(res)).toBe("서울특별시 종로구 사직로 161-3");
  });

  it("status.name이 ok가 아니면 null", () => {
    const res = {
      status: { code: 1, name: "error", message: "fail" },
      results: [],
    };
    expect(extractRoadAddress(res)).toBeNull();
  });

  it("results가 비어 있으면 null", () => {
    const res = {
      status: { code: 0, name: "ok", message: "done" },
      results: [],
    };
    expect(extractRoadAddress(res)).toBeNull();
  });

  it("land.name이 없으면(도로명 매핑 없음) null", () => {
    const res = {
      status: { code: 0, name: "ok", message: "done" },
      results: [
        {
          name: "roadaddr",
          region: {
            area1: { name: "서울특별시" },
            area2: { name: "강동구" },
          },
          land: { name: "", number1: "" },
        },
      ],
    };
    expect(extractRoadAddress(res)).toBeNull();
  });
});

describe("reverseRoadAddress (HTTP 실패는 throw — 호출부가 삼킨다)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 응답이면 도로명 주소를 반환한다", async () => {
    const body = JSON.stringify({
      status: { code: 0, name: "ok", message: "done" },
      results: [
        {
          name: "roadaddr",
          region: {
            area1: { name: "서울특별시" },
            area2: { name: "강동구" },
          },
          land: { name: "천호대로", number1: "1220", number2: "" },
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    expect(await reverseRoadAddress({ lat: 37.5354, lng: 127.1465 })).toBe(
      "서울특별시 강동구 천호대로 1220",
    );
  });

  it("HTTP 에러는 throw한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    await expect(
      reverseRoadAddress({ lat: 37.5354, lng: 127.1465 }),
    ).rejects.toThrow();
  });

  it("무결과(도로명 매핑 없음)는 null", async () => {
    const body = JSON.stringify({
      status: { code: 0, name: "ok", message: "done" },
      results: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    expect(
      await reverseRoadAddress({ lat: 37.5354, lng: 127.1465 }),
    ).toBeNull();
  });
});
