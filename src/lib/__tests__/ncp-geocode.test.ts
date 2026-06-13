import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractEnglishAddress,
  geocodeEnglishAddress,
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
