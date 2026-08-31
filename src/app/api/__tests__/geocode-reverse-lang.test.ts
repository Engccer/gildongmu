import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasKakaoKey: () => true,
  hasNcpMapsKeys: () => false,
  hasJusoKey: () => true,
}));
const coordToAddress = vi.fn();
vi.mock("@/lib/providers/kakao-address", () => ({
  coordToAddress: (...args: unknown[]) => coordToAddress(...args),
}));
vi.mock("@/lib/providers/ncp-geocode", () => ({ reverseRoadAddress: vi.fn() }));
const searchJusoAddresses = vi.fn();
vi.mock("@/lib/providers/juso-address", () => ({
  searchJusoAddresses: (...args: unknown[]) => searchJusoAddresses(...args),
}));

import { GET } from "../geocode/reverse/route";

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/geocode/reverse?${query}`));
}

/**
 * 역지오코딩 영문 병기(E28, spec §7): `lang=en`일 때만 juso 공식 영문(`addressEn`)을 찾고, 없으면
 * 규칙 로마자(`addressRoman`)를 싣는다. ko 요청은 종전 응답 그대로(juso 미호출)다.
 */
describe("/api/geocode/reverse lang", () => {
  beforeEach(() => {
    coordToAddress.mockReset();
    searchJusoAddresses.mockReset();
  });

  it("미지 lang은 조용히 ko로 떨구지 않고 400(langParam 통일, 2026-09-01)", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: "서울 강동구 성내로 12", jibunAddress: null });
    for (const bad of ["EN", "ko-KR", "es", ""]) {
      const res = await get(`lat=37.53&lng=127.12&lang=${encodeURIComponent(bad)}`);
      expect(res.status, `lang=${bad}`).toBe(400);
    }
    expect(coordToAddress).not.toHaveBeenCalled();
  });

  it("lang 누락은 종전대로 ko(400 아님)", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: "서울 강동구 성내로 12", jibunAddress: null });
    const res = await get("lat=37.53&lng=127.12");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: "서울 강동구 성내로 12" });
  });

  it("ko(기본)는 종전 응답 그대로이고 juso를 부르지 않는다", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: "서울 강동구 성내로 12", jibunAddress: "서울 강동구 성내동 1" });
    const res = await get("lat=37.53&lng=127.12");
    expect(await res.json()).toEqual({ address: "서울 강동구 성내로 12" });
    expect(searchJusoAddresses).not.toHaveBeenCalled();
  });

  it("en은 도로명이 같은 juso 결과의 engAddr를 addressEn으로 싣는다", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: "서울 강동구 성내로 12", jibunAddress: null });
    searchJusoAddresses.mockResolvedValue([
      { roadAddr: "서울특별시 강동구 성내로 12 (성내동)", roadAddrPart1: "서울특별시 강동구 성내로 12", engAddr: "12 Seongnae-ro, Gangdong-gu, Seoul" },
    ]);
    const res = await get("lat=37.53&lng=127.12&lang=en");
    const body = await res.json();
    expect(body).toEqual({ address: "서울 강동구 성내로 12", addressEn: "12 Seongnae-ro, Gangdong-gu, Seoul" });
    expect(String(searchJusoAddresses.mock.calls[0][0])).toBe("서울 강동구 성내로 12");
  });

  it("en에서 juso 1위가 다른 건물이면 공식 영문을 신뢰하지 않고 로마자로 물러난다", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: "서울 강동구 성내로 12", jibunAddress: null });
    searchJusoAddresses.mockResolvedValue([
      { roadAddr: "서울특별시 강동구 성내로 120", roadAddrPart1: "서울특별시 강동구 성내로 120", engAddr: "120 Seongnae-ro, Gangdong-gu, Seoul" },
    ]);
    const body = await (await get("lat=37.53&lng=127.12&lang=en")).json();
    expect(body.addressEn).toBeUndefined();
    expect(body.addressRoman).toBe("Seoul Gangdong-gu Seongnae-ro 12");
  });

  it("en에서 지번 폴백(도로명 없음)은 juso 없이 로마자만 싣고, 주소 부재는 필드도 없다", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: null, jibunAddress: "서울 강동구 길동 123-4" });
    const body = await (await get("lat=37.53&lng=127.12&lang=en")).json();
    expect(body).toEqual({ address: "서울 강동구 길동 123-4", addressRoman: "Seoul Gangdong-gu Gil-dong 123-4" });
    expect(searchJusoAddresses).not.toHaveBeenCalled();

    coordToAddress.mockResolvedValue(null);
    expect(await (await get("lat=37.53&lng=127.12&lang=en")).json()).toEqual({ address: null });
  });

  it("juso 실패는 삼키고 로마자로 물러난다(주소는 부가 정보)", async () => {
    coordToAddress.mockResolvedValue({ roadAddress: "서울 강동구 성내로 12", jibunAddress: null });
    searchJusoAddresses.mockRejectedValue(new Error("juso down"));
    const body = await (await get("lat=37.53&lng=127.12&lang=en")).json();
    expect(body.addressRoman).toBe("Seoul Gangdong-gu Seongnae-ro 12");
  });

});
