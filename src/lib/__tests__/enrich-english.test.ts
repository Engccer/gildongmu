import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichEnglishAddresses } from "../providers/places";
import { geocodeEnglishAddress } from "../providers/ncp-geocode";
import type { Place } from "../types";

vi.mock("../providers/ncp-geocode");
const geocodeMock = vi.mocked(geocodeEnglishAddress);

function place(over: Partial<Place> & Pick<Place, "id">): Place {
  return {
    name: "",
    category: "",
    address: "지번주소",
    roadAddress: "한글 도로명 주소",
    lat: 37.5,
    lng: 127.0,
    ...over,
  };
}

describe("enrichEnglishAddresses", () => {
  beforeEach(() => geocodeMock.mockReset());

  it("카카오 카드는 도로명 주소로 영문 주소를 채운다", async () => {
    geocodeMock.mockResolvedValue("161, Sajik-ro, Jongno-gu, Seoul");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(geocodeMock).toHaveBeenCalledWith("한글 도로명 주소");
    expect(out.englishAddress).toBe("161, Sajik-ro, Jongno-gu, Seoul");
  });

  it("TourAPI 카드는 변환하지 않고 그대로 둔다 (이미 영문 주소 보유)", async () => {
    const [out] = await enrichEnglishAddresses([
      place({ id: "tour-1", roadAddress: "161, Sajik-ro" }),
    ]);

    expect(geocodeMock).not.toHaveBeenCalled();
    expect(out.englishAddress).toBeUndefined();
  });

  it("영문 주소를 못 얻으면(null) 채우지 않고 한글 주소를 유지한다", async () => {
    // geocodeEnglishAddress는 실패(HTTP·네트워크)도 null로 흡수하므로,
    // 여기서 null은 "변환 불가"를 대표한다 (graceful degrade).
    geocodeMock.mockResolvedValue(null);

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(out.englishAddress).toBeUndefined();
    expect(out.roadAddress).toBe("한글 도로명 주소");
  });
});
